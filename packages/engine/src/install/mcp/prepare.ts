import type {
  Adapter,
  McpServerCapability,
  McpServerContribution,
  McpServersPlan,
  PlanMcpServersRequest,
} from '@agent-facets/adapter'
import { compareCodeUnits, type PlannedServerConfiguration } from '@agent-facets/protocol'
import { classifyMcpSupport } from '../../adapters/mcp-support.ts'
import type { PreviousMcpOwnership } from '../commit/server-ownership.ts'
import type { OnLog, RunInstallFailure } from '../types.ts'

/**
 * Read-only MCP planning: ask every selected adapter what it *would* change,
 * before anything is prompted for or written.
 *
 * This is the step that makes consent honest. The adapter parses its native
 * document once and reports occupancy and equality, so the engine can show a
 * user exactly what an approval authorizes — and can discover an untracked
 * entry it is about to adopt — without a second scan and without having
 * mutated anything it might have to undo.
 */

/**
 * An engine-observable breach of the MCP capability contract.
 *
 * Kept separate from {@link McpServerCapabilityFailure}: those describe the
 * adapter's world failing (unparseable document, unreadable file) and are
 * expected. This describes the adapter itself misbehaving — reaching a
 * different conclusion about what an operation does between the moment the
 * user approved it and the moment it runs. Reporting that as the former would
 * tell a user to fix their configuration when the bug is in an adapter.
 */
export type McpContractViolation = { kind: 'outcomes-changed'; adapter: string }

/** One adapter's plan, held until the apply step. */
export interface PreparedMcpAdapter {
  adapter: string
  capability: McpServerCapability
  /**
   * The request this plan answered. Retained so the plan can be recomputed
   * against the state an earlier adapter left behind, without the apply step
   * having to reconstruct — and possibly misremember — what was asked.
   */
  request: PlanMcpServersRequest
  plan: McpServersPlan
}

export type PrepareMcpResult =
  | { ok: true; prepared: readonly PreparedMcpAdapter[] }
  | { ok: false; failure: RunInstallFailure }

export interface PrepareMcpArgs {
  projectRoot: string
  /** Every selected adapter, in selection order. */
  adapters: readonly Adapter[]
  /** The active effective configurations this run wants reconciled. */
  configurations: readonly PlannedServerConfiguration[]
  /**
   * Receipt-owned identities nothing desires any more.
   *
   * Passed separately from {@link configurations} because it is half of the
   * answer to "is there MCP work at all?": a project whose desired state
   * declares no server still has work to do if this machine owns an entry
   * that must now be removed.
   */
  obsolete: readonly PreviousMcpOwnership[]
  /**
   * The complete set of effective names the receipt authorizes an adapter to
   * remove. Derived from the receipt alone — never the lockfile, which would
   * let a teammate's commit authorize deleting an entry this machine never
   * wrote.
   */
  previouslyOwnedNames: readonly string[]
  onLog: OnLog
}

/**
 * Verify support and plan every adapter, or fail before any mutation.
 *
 * Returns an empty set — invoking no capability method at all — when the
 * project has neither an active declaration nor an owned identity to remove.
 * That is what keeps an adapter without MCP support usable for a text-only
 * project: support is only required for work that actually exists.
 */
export async function prepareMcpServers(args: PrepareMcpArgs): Promise<PrepareMcpResult> {
  const { projectRoot, adapters, configurations, obsolete, previouslyOwnedNames, onLog } = args

  // No declarations and nothing owned to remove: this project has no MCP
  // state, so no adapter is asked about it and none needs to support it.
  if (configurations.length === 0 && obsolete.length === 0) {
    return { ok: true, prepared: [] }
  }

  const support = classifyMcpSupport(adapters)
  if (!support.ok) {
    return {
      ok: false,
      failure: {
        code: 'MCP_ADAPTERS_UNSUPPORTED',
        adapters: support.unsupported,
        servers: involvedServerNames(configurations, obsolete),
      },
    }
  }

  const desired: McpServerContribution[] = configurations.map((configuration) => ({
    name: configuration.identity.effectiveName,
    declaration: configuration.declaration,
  }))

  const request: PlanMcpServersRequest = { projectRoot, desired, previouslyOwnedNames }
  const prepared: PreparedMcpAdapter[] = []
  for (const { adapter, capability } of support.capable) {
    const result = await capability.plan(request)
    if (!result.ok) {
      return { ok: false, failure: { code: 'MCP_PREPARE_FAILED', adapter, failure: result.failure } }
    }

    // Containment is not re-checked here. Every planned mutation carries the
    // boundary it is authorized to work inside, and the transaction refuses a
    // path that is not strictly below it — one rule, enforced for every file
    // this system writes rather than for MCP documents specifically.
    onLog(
      () =>
        `[verbose] ${adapter}: planned ${result.plan.outcomes.length} MCP outcome(s), ${
          result.plan.action.kind === 'mutate' ? result.plan.action.mutations.length : 0
        } document change(s)`,
    )
    prepared.push({ adapter, capability, request, plan: result.plan })
  }

  return { ok: true, prepared }
}

/**
 * Every effective server name this operation involves, for the
 * unsupported-adapter report.
 *
 * Names only: the remedy is to upgrade an adapter or omit a declaration, and
 * neither needs the command a server would run.
 */
function involvedServerNames(
  configurations: readonly PlannedServerConfiguration[],
  obsolete: readonly PreviousMcpOwnership[],
): string[] {
  const names = new Set<string>()
  for (const configuration of configurations) names.add(configuration.identity.effectiveName)
  for (const ownership of obsolete) names.add(ownership.effectiveName)
  return [...names].sort(compareCodeUnits)
}
