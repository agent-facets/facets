import { isAbsolute, relative, resolve } from 'node:path'
import type { Adapter, McpServerCapability, McpServerContribution, McpServerPreparation } from '@agent-facets/adapter'
import { compareCodeUnits, type PlannedServerConfiguration } from '@agent-facets/protocol'
import { classifyMcpSupport } from '../../adapters/mcp-support.ts'
import type { PreviousMcpOwnership } from '../commit/server-ownership.ts'
import type { OnLog, RunInstallFailure } from '../types.ts'

/**
 * Read-only MCP preparation: ask every selected adapter what it *would*
 * change, before anything is prompted for or written.
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
 * adapter's world failing (unparseable document, unwritable file) and are
 * expected. These describe the adapter itself misbehaving in a way that would
 * make rollback unsound — a document outside the project, or a write to a
 * path whose preimage was never disclosed. Reporting the second as the first
 * would tell a user to fix their config file when the bug is in an adapter.
 */
export type McpContractViolation =
  /** A disclosed document path escapes the project tree. */
  | { kind: 'document-outside-project'; adapter: string; path: string }
  /** `apply` changed a path `prepare` never disclosed, so no preimage exists. */
  | { kind: 'undisclosed-changed-path'; adapter: string; path: string }

/** One adapter's prepared plan, held opaquely until the apply step. */
export interface PreparedMcpAdapter {
  adapter: string
  capability: McpServerCapability
  /**
   * The adapter's own plan and disclosures. `plan` is deliberately `unknown`:
   * the engine stores it and hands it back, and cannot read it.
   */
  preparation: McpServerPreparation<unknown>
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
 * Verify support and prepare every adapter, or fail before any mutation.
 *
 * Returns an empty set — invoking no capability method at all — when the
 * project has neither an active declaration nor an owned identity to remove.
 * That is what keeps an asset-only adapter usable for a text-only project:
 * support is only required for work that actually exists.
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

  const prepared: PreparedMcpAdapter[] = []
  for (const { adapter, capability } of support.capable) {
    const result = await capability.prepare({ projectRoot, desired, previouslyOwnedNames })
    if (!result.ok) {
      return { ok: false, failure: { code: 'MCP_PREPARE_FAILED', adapter, failure: result.failure } }
    }

    // Every disclosed path is a document this run may later restore by
    // writing bytes to it. One that escapes the project turns a rollback into
    // an arbitrary write, so it is refused here — while nothing has been
    // prepared for application and nothing has been mutated.
    for (const path of result.preparation.documentPaths) {
      if (insideProject(projectRoot, path)) continue
      return {
        ok: false,
        failure: {
          code: 'MCP_CONTRACT_VIOLATION',
          violation: { kind: 'document-outside-project', adapter, path },
        },
      }
    }

    onLog(
      () =>
        `[verbose] ${adapter}: prepared ${result.preparation.outcomes.length} MCP outcome(s) across ${result.preparation.documentPaths.length} document(s)`,
    )
    prepared.push({ adapter, capability, preparation: result.preparation })
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

/** Whether an absolute path resolves to somewhere strictly inside the project. */
export function insideProject(projectRoot: string, path: string): boolean {
  const rel = relative(resolve(projectRoot), resolve(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
