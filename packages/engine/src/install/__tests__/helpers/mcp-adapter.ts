import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  ApplyMcpServersResult,
  McpServerCapability,
  McpServerCapabilityFailure,
  PrepareMcpServersRequest,
  PrepareMcpServersResult,
  ReadonlyMcpServerDeclaration,
} from '@agent-facets/adapter'
import { mcpOutcomesRequireWrite, reconcileMcpServers } from '@agent-facets/adapter'

/**
 * A minimal but honest MCP capability for engine tests.
 *
 * Honest in the ways the engine actually depends on: it prepares read-only,
 * discloses the one document it would touch before writing it, reports
 * `unchanged` when nothing needs to move, and derives ownership strictly from
 * `previouslyOwnedNames`. That makes it usable as a stand-in wherever a test
 * needs a `0.2` adapter that can carry MCP work, without importing a
 * first-party adapter's native format into engine's test suite.
 *
 * The document is deliberately a plain JSON map of name to declaration. The
 * native shape is each adapter's business; what engine tests care about is
 * that a document exists, that its bytes change only when they should, and
 * that a rollback can put the old ones back.
 */

/** What the fake wrote, so a test can assert on the sequence. */
export interface McpCapabilityRecorder {
  capability: McpServerCapability
  /** `prepare:<n desired>` / `apply:changed` / `apply:unchanged`, in order. */
  calls: string[]
}

type FakePlan =
  | { kind: 'unchanged'; path: string }
  | { kind: 'write'; path: string; servers: Record<string, ReadonlyMcpServerDeclaration> }

/**
 * Build a capability whose document lives at `documentPath()`.
 *
 * The path is a thunk because engine tests create their project root in
 * `beforeEach`, after the adapter literal has already been written.
 */
export interface RecordingMcpOptions {
  /** Make `prepare` report this failure instead of planning. */
  failPrepare?: McpServerCapabilityFailure
  /**
   * Run while `prepare` is in flight, before it returns.
   *
   * Preparation is the run's last asynchronous read-only step, so this is how
   * a test puts an interrupt exactly where one can really land: after the
   * caller committed to preparing and before it looks at the signal again.
   */
  duringPrepare?: () => void
  /** Make `apply` report this failure instead of writing. */
  failApply?: McpServerCapabilityFailure
  /**
   * Write the disclosed document and *then* report `failApply` — a buggy
   * adapter that broke its own atomicity promise. The engine has to have armed
   * restoration before it called `apply` for that write to be recoverable.
   */
  applyWritesBeforeFailure?: boolean
  /**
   * Write the disclosed document but report that nothing changed. The other
   * half of the same problem: a run can succeed with an unjournaled write.
   */
  applyOmitsChangedPath?: boolean
  /**
   * Report the undisclosed path BEFORE the disclosed one, so a caller that
   * journals while walking the reported paths stops before reaching the real
   * one.
   */
  applyUndisclosedPathFirst?: boolean
  /**
   * Report a changed path `prepare` never disclosed — the contract breach the
   * engine refuses because it has no preimage for it.
   */
  applyUndisclosedPath?: () => string
  /**
   * Disclose an extra document path from `prepare` — used to exercise the
   * engine's containment check on a path outside the project.
   */
  prepareExtraDocumentPath?: () => string
  /**
   * A log this capability appends to alongside its own `calls`.
   *
   * Ordering between asset writes and MCP application is a spec guarantee, and
   * two separate arrays cannot express it — they have no shared clock. Passing
   * the adapter's asset log here puts both domains on one timeline so a test
   * can assert that every asset write precedes `apply`.
   */
  log?: string[]
}

export function recordingMcpCapability(
  documentPath: () => string,
  options: RecordingMcpOptions = {},
): McpCapabilityRecorder {
  const calls: string[] = []
  const record = (entry: string) => {
    calls.push(entry)
    options.log?.push(`mcp:${entry}`)
  }

  const capability: McpServerCapability<FakePlan> = {
    async prepare(request: PrepareMcpServersRequest): Promise<PrepareMcpServersResult<FakePlan>> {
      const path = documentPath()
      record(`prepare:${request.desired.length}`)
      options.duringPrepare?.()
      if (options.failPrepare !== undefined) return { ok: false, failure: options.failPrepare }

      const servers = readServers(path)
      if (!servers.ok) {
        return { ok: false, failure: { code: 'parse-failed', path, message: servers.message } }
      }

      const outcomes = reconcileMcpServers({
        desired: request.desired,
        previouslyOwnedNames: request.previouslyOwnedNames,
        presentNames: new Set(Object.keys(servers.value)),
        // Byte equality of the serialized declaration stands in for an
        // adapter's native comparison: this fake's "native format" IS the
        // portable one, so anything else would be pretending.
        compare: (contribution) =>
          JSON.stringify(servers.value[contribution.name]) === JSON.stringify(contribution.declaration)
            ? 'equivalent'
            : 'divergent',
      })

      const extra = options.prepareExtraDocumentPath?.()
      // Non-empty by contract: disclosure is what the engine journals against,
      // so "no documents" is not a thing a preparation can say.
      const documentPaths: readonly [string, ...string[]] = extra === undefined ? [path] : [path, extra]

      if (!mcpOutcomesRequireWrite(outcomes)) {
        return { ok: true, preparation: { plan: { kind: 'unchanged', path }, documentPaths, outcomes } }
      }

      const next: Record<string, ReadonlyMcpServerDeclaration> = { ...servers.value }
      for (const outcome of outcomes) {
        if (outcome.kind === 'obsolete-owned') {
          delete next[outcome.name]
          continue
        }
        const contribution = request.desired.find((entry) => entry.name === outcome.name)
        if (contribution !== undefined) next[outcome.name] = contribution.declaration
      }

      return {
        ok: true,
        preparation: { plan: { kind: 'write', path, servers: next }, documentPaths, outcomes },
      }
    },

    async apply(request: { plan: FakePlan }): Promise<ApplyMcpServersResult> {
      const plan = request.plan
      if (plan.kind === 'unchanged') {
        record('apply:unchanged')
        return { ok: true, status: 'unchanged' }
      }
      const write = (): void => {
        mkdirSync(dirname(plan.path), { recursive: true })
        writeFileSync(plan.path, `${JSON.stringify(plan.servers, null, 2)}\n`)
      }

      if (options.failApply !== undefined) {
        record('apply:failed')
        if (options.applyWritesBeforeFailure === true) write()
        return { ok: false, failure: options.failApply }
      }
      record('apply:changed')
      write()
      if (options.applyOmitsChangedPath === true) {
        return { ok: true, status: 'unchanged' }
      }
      const undisclosed = options.applyUndisclosedPath?.()
      if (undisclosed !== undefined) {
        return options.applyUndisclosedPathFirst === true
          ? { ok: true, status: 'changed', changedPaths: [undisclosed, plan.path] }
          : { ok: true, status: 'changed', changedPaths: [undisclosed] }
      }
      return { ok: true, status: 'changed', changedPaths: [plan.path] }
    },
  }

  return { capability, calls }
}

function readServers(
  path: string,
): { ok: true; value: Record<string, ReadonlyMcpServerDeclaration> } | { ok: false; message: string } {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { ok: true, value: {} }
  }
  try {
    return { ok: true, value: JSON.parse(text) as Record<string, ReadonlyMcpServerDeclaration> }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
