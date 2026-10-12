import type { SupportedLockfile } from '../loaders/lockfile.ts'
import type { McpServerFingerprint } from '../mcp/fingerprint.ts'
import { compareCodeUnits } from '../ordering.ts'
import {
  LOCKFILE_VERSION_0_2,
  LOCKFILE_VERSION_0_3,
  LOCKFILE_VERSION_0_4,
  type Lockfile04,
  type LockfileSource,
} from '../schemas/lockfile.ts'
import {
  cloneDisposition,
  type MaterializationDisposition,
  type MaterializedDisposition,
  type ProjectAssetOverride,
} from '../schemas/materialization.ts'
import { type LockedServerContribution, planLockedServerInventory } from './servers.ts'

/**
 * Locked MCP inventory derivation — the selected server set and every
 * contributing origin, read from a lockfile alone.
 *
 * This describes RECORDED state: the names, fingerprints, and dispositions a
 * `0.4` lockfile carries, under exactly the rules declaration-based planning
 * applies. It takes no project-manifest overrides (that is hypothetical
 * intent; use `planLockedServerInventory` for it), performs no I/O, and
 * verifies nothing — a fingerprint is reported as recorded, and success says
 * only that a selection can be derived, not that anything was installed,
 * approved, or is authentic.
 */

/** One active contribution to a selected server, with the provenance of its facet. */
export interface LockedMcpOrigin {
  readonly facet: string
  readonly source: Readonly<LockfileSource>
  /** The facet's resolved version. */
  readonly version: string
  /** The facet's archive integrity, as recorded. */
  readonly facetIntegrity: string
  readonly authoredName: string
  readonly materialization: Readonly<MaterializedDisposition>
}

/** One authored server record, including omitted ones, with its facet's provenance. */
export interface LockedMcpAuthoredServer {
  readonly facet: string
  readonly source: Readonly<LockfileSource>
  readonly version: string
  readonly facetIntegrity: string
  readonly authoredName: string
  readonly fingerprint: McpServerFingerprint
  readonly materialization: Readonly<MaterializationDisposition>
}

/** One selected effective server and every origin that claims it. */
export interface LockedMcpServer {
  readonly effectiveName: string
  readonly fingerprint: McpServerFingerprint
  /** Never empty; no origin is a "winner". */
  readonly origins: readonly [LockedMcpOrigin, ...LockedMcpOrigin[]]
}

/** One claimant of a contested effective identity. */
export interface LockedMcpCollisionMember extends LockedMcpOrigin {
  readonly effectiveName: string
  readonly fingerprint: McpServerFingerprint
}

/** Two or more differing fingerprints claiming one effective identity. */
export interface LockedMcpCollisionGroup {
  readonly effectiveName: string
  readonly members: readonly LockedMcpCollisionMember[]
}

export type DeriveLockedMcpInventoryResult =
  | {
      readonly ok: true
      /** Every recorded server, omitted ones included, ordered by facet then authored name. */
      readonly authored: readonly LockedMcpAuthoredServer[]
      /** The selected set, in portable identity order. */
      readonly servers: readonly LockedMcpServer[]
    }
  | {
      readonly ok: false
      readonly reason: 'inventory-unavailable'
      /** The observed format, which predates server inventory. */
      readonly lockfileVersion: typeof LOCKFILE_VERSION_0_2 | typeof LOCKFILE_VERSION_0_3
      readonly requiredVersion: typeof LOCKFILE_VERSION_0_4
    }
  | {
      readonly ok: false
      readonly reason: 'collision'
      /** The complete authored inventory is still reported; no partial selection is. */
      readonly authored: readonly LockedMcpAuthoredServer[]
      readonly groups: readonly LockedMcpCollisionGroup[]
    }

/** The provenance every record of one facet shares. */
interface FacetProvenance {
  readonly source: Readonly<LockfileSource>
  readonly version: string
  readonly facetIntegrity: string
}

/**
 * Derive the recorded MCP inventory from a validated lockfile.
 *
 * Capability is decided by the document's exact version, never by probing
 * for a `servers` field: a `0.2` or `0.3` document may legally carry an
 * extension by that name, and it is not inventory.
 */
export function deriveLockedMcpInventory(lockfile: SupportedLockfile): DeriveLockedMcpInventoryResult {
  switch (lockfile.lockfileVersion) {
    case LOCKFILE_VERSION_0_2:
    case LOCKFILE_VERSION_0_3:
      return {
        ok: false,
        reason: 'inventory-unavailable',
        lockfileVersion: lockfile.lockfileVersion,
        requiredVersion: LOCKFILE_VERSION_0_4,
      }
    case LOCKFILE_VERSION_0_4:
      return deriveFrom04(lockfile)
  }
}

function deriveFrom04(lockfile: Lockfile04): DeriveLockedMcpInventoryResult {
  // A Map rather than an object index: facet names are unconstrained strings,
  // and `__proto__` or `constructor` must be ordinary keys here.
  const provenance = new Map<string, FacetProvenance>()
  const authored: LockedMcpAuthoredServer[] = []
  const contributions: LockedServerContribution[] = []

  for (const facet of Object.keys(lockfile.facets).sort(compareCodeUnits)) {
    const entry = lockfile.facets[facet]
    if (entry === undefined) continue

    const facetProvenance: FacetProvenance = {
      source: copySource(entry.source),
      version: entry.version,
      facetIntegrity: entry.integrity,
    }
    provenance.set(facet, facetProvenance)

    // Recorded dispositions become the overrides the planner reads. Absence
    // already means authored, so only the two non-default arms are passed.
    const overrides: Record<string, ProjectAssetOverride> = {}
    for (const server of entry.servers) {
      authored.push({
        facet,
        ...copyProvenance(facetProvenance),
        authoredName: server.name,
        fingerprint: server.fingerprint,
        materialization: cloneDisposition(server.materialization),
      })
      const disposition = server.materialization
      if (disposition.kind !== 'authored') {
        Object.defineProperty(overrides, server.name, {
          value: cloneDisposition(disposition),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
    }

    contributions.push({
      facet,
      servers: entry.servers.map((server) => ({ name: server.name, fingerprint: server.fingerprint })),
      overrides: Object.keys(overrides).length === 0 ? undefined : { servers: overrides },
    })
  }

  // The schema already orders records within a facet; sorting the whole view
  // makes the facet-then-authored-name order independent of that guarantee.
  authored.sort((a, b) => compareCodeUnits(a.facet, b.facet) || compareCodeUnits(a.authoredName, b.authoredName))

  const plan = planLockedServerInventory(contributions)

  if (!plan.ok && plan.reason === 'invalid-alias') {
    // Every recorded alias passed the disposition schema's own grammar check,
    // so the planner cannot reject one. Reaching this is a bug, not data.
    throw new Error('deriveLockedMcpInventory: a schema-valid lockfile produced an invalid alias')
  }

  const originOf = (facet: string, authoredName: string, materialization: MaterializedDisposition) => {
    const facetProvenance = provenance.get(facet)
    if (facetProvenance === undefined) {
      throw new Error(`deriveLockedMcpInventory: planner reported unknown facet "${facet}"`)
    }
    return {
      facet,
      ...copyProvenance(facetProvenance),
      authoredName,
      materialization: cloneDisposition(materialization),
    }
  }

  if (!plan.ok) {
    return {
      ok: false,
      reason: 'collision',
      authored,
      groups: plan.groups.map((group) => ({
        effectiveName: group.effectiveName,
        members: group.members.flatMap((member) =>
          // Collision members are always active claims; an omitted record
          // never enters the effective set it could collide in.
          member.disposition.kind === 'omitted'
            ? []
            : [
                {
                  ...originOf(member.facet, member.authoredName, member.disposition),
                  effectiveName: member.effectiveName,
                  fingerprint: member.fingerprint,
                },
              ],
        ),
      })),
    }
  }

  const servers: LockedMcpServer[] = plan.configurations.map((configuration) => {
    const [first, ...rest] = configuration.claimants.map((claimant) =>
      originOf(claimant.facet, claimant.authoredName, claimant.disposition),
    )
    if (first === undefined) {
      throw new Error('deriveLockedMcpInventory: planner produced a configuration with no claimant')
    }
    return {
      effectiveName: configuration.identity.effectiveName,
      fingerprint: configuration.fingerprint,
      origins: [first, ...rest],
    }
  })

  return { ok: true, authored, servers }
}

/**
 * A fresh copy of the recognized fields of a source, and nothing else.
 * Spreading the input would carry its opaque extensions into public output.
 */
function copySource(source: LockfileSource): LockfileSource {
  switch (source.kind) {
    case 'registry':
      return { kind: 'registry', registry: source.registry }
    case 'git':
      return { kind: 'git', url: source.url, commit: source.commit }
    case 'local':
      return { kind: 'local', path: source.path }
  }
}

/** Per-record provenance, so no two output records share a source object. */
function copyProvenance(provenance: FacetProvenance): FacetProvenance {
  return {
    source: copySource(provenance.source),
    version: provenance.version,
    facetIntegrity: provenance.facetIntegrity,
  }
}
