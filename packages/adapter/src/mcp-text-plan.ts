import { readFile } from 'node:fs/promises'
import { atomicWriteFileSync } from '@agent-facets/common'
import { errorMessage, isMissingFileError } from './asset-fs.ts'
import { isPlainObject } from './mcp-native-values.ts'
import {
  type McpNativeMatch,
  mcpDeclarationLiterals,
  mcpOutcomesRequireWrite,
  reconcileMcpServers,
} from './mcp-reconcile.ts'
import type {
  ApplyMcpServersResult,
  McpServerCapabilityFailure,
  McpServerContribution,
  McpServerPreparation,
  McpServerPreparationOutcome,
  PrepareMcpServersRequest,
  PrepareMcpServersResult,
} from './mcp-servers.ts'

/**
 * The format-independent half of an MCP capability.
 *
 * Every tool this SDK targets keeps its MCP servers in a text document, and
 * every adapter therefore does the same work around its own parser: read, guard
 * the authored literals, classify what is present against what is desired,
 * stop when nothing needs writing, disclose the documents a write could touch,
 * re-read them immediately before writing so a concurrent edit is reported
 * rather than clobbered, and write each one atomically.
 *
 * Only four things are genuinely tool-specific — which documents to consider,
 * how to parse them, how to compare one entry, and how to render an edit — so
 * only those are left to the adapter. Everything else lives here, once.
 *
 * The plan is a *list* of edits rather than one document because a tool may
 * merge several configuration layers: making an entry effective can require
 * writing one layer and removing a shadowing copy from another, and those two
 * writes are one change.
 */

/** One document a plan would write. */
export interface TextDocumentEdit {
  readonly path: string
  /** The document's exact text when it was inspected, or `null` if absent. */
  readonly expected: string | null
  /** The complete text to commit. */
  readonly contents: string
}

/**
 * A prepared change to one or more text documents.
 *
 * `documentPaths` is every document the adapter inspected, which is what the
 * caller journals preimages for. It is deliberately wider than the edits: a
 * layered configuration is classified against documents a given run may not
 * end up writing, and a caller that was never told about one cannot restore it.
 */
export type McpTextPlan =
  | { readonly kind: 'unchanged'; readonly documentPaths: readonly [string, ...string[]] }
  | {
      readonly kind: 'write'
      readonly documentPaths: readonly [string, ...string[]]
      readonly edits: readonly [TextDocumentEdit, ...TextDocumentEdit[]]
    }

/**
 * Narrow the opaque plan the caller handed back.
 *
 * A value that fails this check did not come from `prepare`. That is a
 * violated contract rather than a condition a caller could act on, which is
 * the one case where throwing is the honest answer.
 */
export function asMcpTextPlan(value: unknown, adapterName: string): McpTextPlan {
  const plan = readTextPlan(value)
  if (plan === undefined) {
    throw new Error(`${adapterName}: apply() received a plan this adapter did not produce`)
  }
  return plan
}

function readTextPlan(value: unknown): McpTextPlan | undefined {
  if (!isPlainObject(value)) return undefined
  const documentPaths = readNonEmptyStrings(value.documentPaths)
  if (documentPaths === undefined) return undefined

  if (value.kind === 'unchanged') return { kind: 'unchanged', documentPaths }
  if (value.kind !== 'write' || !Array.isArray(value.edits) || value.edits.length === 0) return undefined

  const edits: TextDocumentEdit[] = []
  for (const candidate of value.edits) {
    if (!isPlainObject(candidate)) return undefined
    const { path, expected, contents } = candidate
    if (typeof path !== 'string' || typeof contents !== 'string') return undefined
    if (expected !== null && typeof expected !== 'string') return undefined
    // A path written twice would make the second write depend on text the
    // first one replaced, so the plan's own preflight could never be true for
    // both. Rejected here rather than discovered mid-write.
    if (edits.some((edit) => edit.path === path)) return undefined
    edits.push({ path, expected, contents })
  }

  const [first, ...rest] = edits
  if (first === undefined) return undefined
  return { kind: 'write', documentPaths, edits: [first, ...rest] }
}

function readNonEmptyStrings(value: unknown): readonly [string, ...string[]] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((entry) => typeof entry === 'string')) return undefined
  const [first, ...rest] = value as string[]
  return first === undefined ? undefined : [first, ...rest]
}

/** Hook for work a document needs before it can be written, such as its directory. */
export interface ApplyMcpTextPlanOptions {
  readonly adapterName: string
  /** Called once per edited document, immediately before its write. */
  readonly beforeWrite?: (path: string) => Promise<void>
}

/**
 * Commit a prepared text plan.
 *
 * Every edited document is re-read and compared *before* any of them is
 * written. Checking each one immediately before its own write would leave a
 * two-document change half-applied when the second document turned out to have
 * drifted, and the caller's rollback would then be undoing a write this
 * adapter should never have made.
 */
export async function applyMcpTextPlan(
  plan: unknown,
  options: ApplyMcpTextPlanOptions,
): Promise<ApplyMcpServersResult> {
  const narrowed = asMcpTextPlan(plan, options.adapterName)
  if (narrowed.kind === 'unchanged') return { ok: true, status: 'unchanged' }

  for (const edit of narrowed.edits) {
    const current = await readTextOrAbsent(edit.path)
    if (!current.ok) return { ok: false, failure: current.failure }
    if (current.text !== edit.expected) {
      return {
        ok: false,
        failure: {
          code: 'conflict',
          path: edit.path,
          message: `${edit.path} changed after it was inspected; nothing was written`,
        },
      }
    }
  }

  const changed: string[] = []
  for (const edit of narrowed.edits) {
    try {
      await options.beforeWrite?.(edit.path)
      atomicWriteFileSync(edit.path, edit.contents)
    } catch (err) {
      return {
        ok: false,
        failure: { code: 'io-failed', operation: 'write', path: edit.path, message: errorMessage(err) },
      }
    }
    changed.push(edit.path)
  }

  const [first, ...rest] = changed
  // Unreachable: the plan's edit list is non-empty by construction, and every
  // edit either pushes a path or returns above.
  if (first === undefined) return { ok: true, status: 'unchanged' }
  return { ok: true, status: 'changed', changedPaths: [first, ...rest] }
}

/** A document's text, or the fact that it does not exist. */
export type ReadTextResult =
  | { readonly ok: true; readonly text: string | null }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

/** Read one document, treating absence as a value rather than a failure. */
export async function readTextOrAbsent(path: string): Promise<ReadTextResult> {
  try {
    return { ok: true, text: await readFile(path, 'utf8') }
  } catch (err) {
    if (isMissingFileError(err)) return { ok: true, text: null }
    return { ok: false, failure: { code: 'io-failed', operation: 'read', path, message: errorMessage(err) } }
  }
}

/** The interpolation syntax a target tool would expand inside its own configuration. */
export interface InterpolationGuard {
  /** Matches any value the tool would substitute rather than use literally. */
  readonly pattern: RegExp
  /** The document the conflict is reported against. */
  readonly path: string
}

/**
 * Reject an authored literal the target tool would expand.
 *
 * A portable declaration is literal by contract, so a value the tool would
 * replace cannot be written faithfully: the tool would launch a different
 * command, receive a substituted secret, or dial a different endpoint. Failing
 * closed here is the only answer that keeps the written configuration equal to
 * the approved declaration.
 */
export function findInterpolationConflict(
  desired: readonly McpServerContribution[],
  guard: InterpolationGuard,
): McpServerCapabilityFailure | undefined {
  for (const contribution of desired) {
    const literal = mcpDeclarationLiterals(contribution.declaration).find((value) => guard.pattern.test(value))
    if (literal === undefined) continue
    return {
      code: 'conflict',
      path: guard.path,
      message: `server "${contribution.name}" declares a value this tool would interpolate rather than use literally: ${literal}`,
    }
  }
  return undefined
}

/** What an adapter supplies to turn its parsed documents into a prepared plan. */
export interface PrepareMcpTextPlanInput {
  readonly request: PrepareMcpServersRequest
  /** Every document inspected, disclosed so the caller can journal preimages. */
  readonly documentPaths: readonly [string, ...string[]]
  /** The tool's interpolation syntax, when it has one. */
  readonly interpolation?: InterpolationGuard | undefined
  /** Every effective server name the tool's merged configuration currently defines. */
  readonly presentNames: ReadonlySet<string>
  /** Compare one desired declaration with the entry already defined under its name. */
  readonly compare: (contribution: McpServerContribution) => McpNativeMatch
  /**
   * Render the outcomes that need writing as document edits. Called only when
   * at least one outcome requires a write, and free to fail: producing the new
   * text is where a format-specific editor can discover it cannot express the
   * change.
   */
  readonly buildEdits: (
    outcomes: readonly McpServerPreparationOutcome[],
  ) =>
    | { readonly ok: true; readonly edits: readonly TextDocumentEdit[] }
    | { readonly ok: false; readonly failure: McpServerCapabilityFailure }
}

/**
 * Classify the desired set and build the plan.
 *
 * The adapter has already read and parsed its documents by this point; what is
 * left is the sequence every adapter shares, in the one order that is correct:
 * guard literals before comparing anything, classify against the merged view,
 * short-circuit when nothing needs a write, and only then ask the adapter to
 * render edits.
 */
export function prepareMcpTextPlan(input: PrepareMcpTextPlanInput): PrepareMcpServersResult<McpTextPlan> {
  if (input.interpolation !== undefined) {
    const conflict = findInterpolationConflict(input.request.desired, input.interpolation)
    if (conflict !== undefined) return { ok: false, failure: conflict }
  }

  const outcomes = reconcileMcpServers({
    desired: input.request.desired,
    previouslyOwnedNames: input.request.previouslyOwnedNames,
    presentNames: input.presentNames,
    compare: input.compare,
  })

  if (!mcpOutcomesRequireWrite(outcomes)) {
    return preparation({ kind: 'unchanged', documentPaths: input.documentPaths }, outcomes)
  }

  const built = input.buildEdits(outcomes)
  if (!built.ok) return { ok: false, failure: built.failure }

  const [first, ...rest] = built.edits
  if (first === undefined) {
    // An adapter that reports work and then renders no edit would produce a
    // plan claiming a write it cannot perform. Reported as unchanged is worse
    // — it would drop the work silently — so this is the adapter's own
    // contract, checked here rather than trusted.
    throw new Error('prepareMcpTextPlan: outcomes require a write but no document edit was produced')
  }

  return preparation({ kind: 'write', documentPaths: input.documentPaths, edits: [first, ...rest] }, outcomes)
}

function preparation(
  plan: McpTextPlan,
  outcomes: readonly McpServerPreparationOutcome[],
): PrepareMcpServersResult<McpTextPlan> {
  const value: McpServerPreparation<McpTextPlan> = { plan, documentPaths: plan.documentPaths, outcomes }
  return { ok: true, preparation: value }
}
