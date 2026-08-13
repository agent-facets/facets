import type { FileMutation, FileState } from '@agent-facets/common'
import { encodeText, readFileState, stateHoldsBytes } from './asset-fs.ts'
import {
  type McpNativeMatch,
  mcpDeclarationLiterals,
  mcpOutcomesRequireWrite,
  reconcileMcpServers,
} from './mcp-reconcile.ts'
import type {
  McpServerCapabilityFailure,
  McpServerContribution,
  McpServerPreparationOutcome,
  PlanMcpServersRequest,
  PlanMcpServersResult,
} from './mcp-servers.ts'
import type { AdapterPlanFailure } from './types.ts'

/**
 * The format-independent half of an MCP capability.
 *
 * Every tool this SDK targets keeps its MCP servers in a text document, and
 * every adapter therefore does the same work around its own parser: read,
 * guard the authored literals, classify what is present against what is
 * desired, stop when nothing needs writing, and render the new text.
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

/** A document the adapter inspected, with the exact state it was in. */
export interface McpTextDocument {
  readonly path: string
  readonly state: FileState
}

/** One document a plan would write. */
export interface TextDocumentEdit {
  readonly path: string
  /** The complete text to commit. */
  readonly contents: string
}

/** A document's text, its exact state, or the fact that it does not exist. */
export type ReadTextResult =
  | { readonly ok: true; readonly text: string | null; readonly document: McpTextDocument }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

/**
 * Read one document, treating absence as a value rather than a failure.
 *
 * Returns the exact state alongside the decoded text: the text is what the
 * adapter's parser needs, and the state is what a caller needs to detect a
 * concurrent edit and to put the bytes back if the operation fails.
 */
export function readTextOrAbsent(path: string): ReadTextResult {
  const state = readFileState(path)
  if (!state.ok) {
    // An unsupported object where a configuration document belongs is a
    // validation problem, not an I/O one: the file is readable in principle
    // and the tool's configuration simply is not what this adapter can edit.
    return {
      ok: false,
      failure:
        state.failure.code === 'io-failed'
          ? { code: 'io-failed', path, message: state.failure.message }
          : { code: 'validation-failed', path, message: describeUnusablePath(state.failure) },
    }
  }
  if (state.state.kind === 'absent') {
    return { ok: true, text: null, document: { path, state: state.state } }
  }
  return {
    ok: true,
    // `ignoreBOM` keeps a leading byte-order mark in the string instead of
    // silently consuming it. Adapters split it off and put it back so a user's
    // editor does not re-add it on their next save; a decoder that ate it here
    // would make that preservation impossible and invisible.
    text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(state.state.contents),
    document: { path, state: state.state },
  }
}

function describeUnusablePath(failure: AdapterPlanFailure): string {
  switch (failure.code) {
    case 'unsupported-object':
    case 'unrepresentable':
      return failure.detail
    case 'invalid-companion-path':
      return failure.reason
    case 'unsupported-scope':
      return `scope ${failure.scope} is not supported`
    case 'io-failed':
      return failure.message
  }
}

/** The interpolation syntax a target tool would expand inside its own configuration. */
export interface InterpolationGuard {
  /** Matches any value the tool would substitute rather than use literally. */
  readonly pattern: RegExp
}

/**
 * Reject an authored literal the target tool would expand.
 *
 * A portable declaration is literal by contract, so a value the tool would
 * replace cannot be written faithfully: the tool would launch a different
 * command, receive a substituted secret, or dial a different endpoint. Failing
 * closed here is the only answer that keeps the written configuration equal to
 * the approved declaration.
 *
 * No document is named. The declaration is unwritable for this tool wherever
 * it would land, and a guard consulted before a write target is even chosen
 * has no path to report that would not be a guess.
 */
export function findInterpolationConflict(
  desired: readonly McpServerContribution[],
  guard: InterpolationGuard,
): McpServerCapabilityFailure | undefined {
  const pattern = statelessPattern(guard.pattern)
  for (const contribution of desired) {
    const literal = mcpDeclarationLiterals(contribution.declaration).find((value) => pattern.test(value))
    if (literal === undefined) continue
    return { code: 'conflict', reason: 'interpolation', serverName: contribution.name, value: literal }
  }
  return undefined
}

/**
 * The same pattern, without the flags that make `test` stateful.
 *
 * `RegExp.prototype.test` on a global or sticky pattern advances `lastIndex`
 * and resumes from there on the next call, so scanning several literals with
 * one adapter-supplied object would skip matches — a guard that fails *open*,
 * silently, and only for some inputs. Rebuilt rather than reset because the
 * pattern belongs to the caller.
 */
function statelessPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.replaceAll(/[gy]/g, '')
  return flags === pattern.flags ? pattern : new RegExp(pattern.source, flags)
}

/** What an adapter supplies to turn its parsed documents into a plan. */
export interface PrepareMcpTextPlanInput {
  readonly request: PlanMcpServersRequest
  /** Every document inspected, with the exact state each was in. Non-empty. */
  readonly documents: readonly [McpTextDocument, ...McpTextDocument[]]
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
 *
 * An edit whose rendered text equals what the document already holds is
 * dropped. Adapters legitimately re-render a whole layer to change one entry,
 * and writing back identical bytes would journal a transition this run did not
 * make and wake every tool watching that file.
 */
export function prepareMcpTextPlan(input: PrepareMcpTextPlanInput): PlanMcpServersResult {
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
    return { ok: true, plan: { outcomes, action: { kind: 'unchanged' } } }
  }

  const built = input.buildEdits(outcomes)
  if (!built.ok) return { ok: false, failure: built.failure }

  const states = new Map(input.documents.map((document) => [document.path, document.state]))
  const mutations: FileMutation[] = []
  for (const edit of built.edits) {
    const expected = states.get(edit.path)
    if (expected === undefined) {
      // The adapter rendered an edit for a document it never reported reading,
      // so no exact prior state exists for it. Caught here, before the plan is
      // applicable, rather than by the caller after the bytes are on disk.
      // The adapter broke its own contract, and no caller can act on it.
      throw new Error(`prepareMcpTextPlan: buildEdits produced an edit for an uninspected document: ${edit.path}`)
    }
    const contents = encodeText(edit.contents)
    if (stateHoldsBytes(expected, contents)) continue
    mutations.push({
      kind: 'write',
      path: edit.path,
      boundary: input.request.projectRoot,
      expected,
      contents,
    })
  }

  const [first, ...rest] = mutations
  if (first === undefined) {
    // Every rendered edit turned out to be byte-identical to what is already
    // there. The outcomes still describe real adoption work for the caller to
    // report; the filesystem simply has nothing to do.
    return { ok: true, plan: { outcomes, action: { kind: 'unchanged' } } }
  }
  return { ok: true, plan: { outcomes, action: { kind: 'mutate', mutations: [first, ...rest] } } }
}
