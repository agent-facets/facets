import type {
  FileMutation,
  FileState,
  McpServerCapability,
  McpServerCapabilityFailure,
  PlanMcpServersRequest,
  PlanMcpServersResult,
  ReadonlyMcpServerDeclaration,
} from '@agent-facets/adapter'
import { mcpOutcomesRequireWrite, reconcileMcpServers } from '@agent-facets/adapter'
import { inspectFileState } from '@agent-facets/common'

/**
 * A minimal but honest MCP capability for engine tests.
 *
 * Honest in the ways the engine actually depends on: it plans read-only,
 * reports `unchanged` when nothing needs to move, states the exact state each
 * document was inspected in, and derives ownership strictly from
 * `previouslyOwnedNames`. That makes it usable wherever a test needs an
 * adapter that can carry MCP work, without importing a first-party adapter's
 * native format into engine's test suite.
 *
 * The document is deliberately a plain JSON map of name to declaration. The
 * native shape is each adapter's business; what engine tests care about is
 * that a document exists, that its bytes change only when they should, and
 * that a rollback can put the old ones back.
 */

/** What the fake planned, so a test can assert on the sequence. */
export interface McpCapabilityRecorder {
  capability: McpServerCapability
  /** `plan:<n desired>` then `plan:changed` / `plan:unchanged`, in order. */
  calls: string[]
}

export interface RecordingMcpOptions {
  /** Make `plan` report this failure instead of planning. */
  failPrepare?: McpServerCapabilityFailure
  /**
   * Run while `plan` is in flight, before it returns.
   *
   * Planning is the run's last asynchronous read-only step, so this is how a
   * test puts an interrupt exactly where one can really land: after the caller
   * committed to planning and before it looks at the signal again.
   */
  duringPrepare?: () => void
  /**
   * Make the SECOND plan — the one taken immediately before committing —
   * report this failure. The first still succeeds, so consent is collected
   * against a plan the run then cannot carry out.
   */
  failApply?: McpServerCapabilityFailure
  /**
   * Plan a write to this path as well. Used to exercise the transaction's
   * containment check on a path outside the project.
   */
  planExtraDocumentPath?: () => string
  /**
   * A log this capability appends to alongside its own `calls`.
   *
   * Ordering between asset writes and MCP application is a spec guarantee, and
   * two separate arrays cannot express it — they have no shared clock.
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
  let planCount = 0

  const capability: McpServerCapability = {
    async plan(request: PlanMcpServersRequest): Promise<PlanMcpServersResult> {
      const path = documentPath()
      planCount++
      record(`plan:${request.desired.length}`)
      options.duringPrepare?.()
      if (options.failPrepare !== undefined) return { ok: false, failure: options.failPrepare }
      // The second plan is the pre-commit one: failing there is how a test
      // reaches the state where consent was given and the write still cannot
      // happen.
      if (options.failApply !== undefined && planCount > 1) return { ok: false, failure: options.failApply }

      const inspected = inspectFileState(path)
      if (!inspected.ok) {
        return { ok: false, failure: { code: 'io-failed', path, message: inspected.failure.reason } }
      }
      const servers = readServers(inspected.state)
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

      if (!mcpOutcomesRequireWrite(outcomes)) {
        record('plan:unchanged')
        return { ok: true, plan: { outcomes, action: { kind: 'unchanged' } } }
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

      record('plan:changed')
      const contents = new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`)
      const extra = options.planExtraDocumentPath?.()
      const first: FileMutation = {
        kind: 'write',
        path,
        boundary: request.projectRoot,
        expected: inspected.state,
        contents,
      }
      const mutations: [FileMutation, ...FileMutation[]] = [first]
      if (extra !== undefined) {
        const extraState = inspectFileState(extra)
        mutations.push({
          kind: 'write',
          path: extra,
          boundary: request.projectRoot,
          expected: extraState.ok ? extraState.state : { kind: 'absent' },
          contents,
        })
      }
      return { ok: true, plan: { outcomes, action: { kind: 'mutate', mutations } } }
    },
  }

  return { capability, calls }
}

function readServers(
  state: FileState,
): { ok: true; value: Record<string, ReadonlyMcpServerDeclaration> } | { ok: false; message: string } {
  if (state.kind === 'absent') return { ok: true, value: {} }
  try {
    const text = new TextDecoder().decode(state.contents)
    return { ok: true, value: JSON.parse(text) as Record<string, ReadonlyMcpServerDeclaration> }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
