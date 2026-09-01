/**
 * Read-only update discovery.
 *
 * Answers, for a whole project at once, what each registry facet is
 * installed at and what it could move to. Nothing here writes: no
 * downloads, no cache, no lock directory, no project files. The result
 * is either one complete plan or one failure — never a partial answer,
 * because a user shown nine of ten facets has no way to know the tenth
 * was omitted.
 */

import type { SupportedLockfile } from '@agent-facets/protocol'
import { satisfies } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { MAX_REGISTRY_METADATA_SPECIFIERS, resolveRegistryMetadataBatch } from '../../registry/resolve-metadata.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from '../../registry/types.ts'
import { ownEntry } from '../own-entry.ts'
import { parseManifestFacetSource } from '../parse-manifest-source.ts'
import type { AuthoredSpecifier } from './manifest-source.ts'
import type {
  AdvancingChoices,
  CheckableRegistryFacet,
  PrepareFacetUpdateFailure,
  ResolvedChoice,
  UnusableFacetState,
  UpdatePlanRow,
} from './types.ts'
import { type ExactVersion, isNewerThan, parseExactVersion } from './version-order.ts'

/** The batch-resolution boundary, injectable so grouping can be tested. */
export type ResolveMetadataBatch = (
  specs: ReadonlyArray<RegistrySpec>,
) => Promise<RegistryResult<ReadonlyArray<RegistryMetadata>>>

/** Everything discovery alone can fail with. */
export type DiscoverUpdatesFailure = Extract<
  PrepareFacetUpdateFailure,
  { reason: 'unusable-facet-state' | 'discovery-failed' | 'invalid-resolved-version' | 'target-outside-range' }
>

export type DiscoverUpdatesResult =
  | { ok: true; plan: readonly UpdatePlanRow[] }
  | { ok: false; failure: DiscoverUpdatesFailure }

export interface DiscoverUpdatesArgs {
  facets: Readonly<Record<string, NormalizedFacetEntry>>
  lockfile: SupportedLockfile
  resolve?: ResolveMetadataBatch
}

/** A registry facet that passed local-state checks and needs resolving. */
interface PendingFacet {
  name: string
  authored: AuthoredSpecifier
  current: ExactVersion
}

/**
 * A manifest entry's place in the plan: either a row already decided
 * without the registry, or a facet still waiting on resolution.
 *
 * Slots exist so the finished plan comes back in manifest order.
 * Appending resolved rows after the unresolvable ones would reorder the
 * user's project in the output for no reason other than the order the
 * code happened to learn things.
 */
type PlanSlot = { kind: 'settled'; row: UpdatePlanRow } | { kind: 'pending' }

/**
 * Build the update plan for a project.
 *
 * Local state is settled first and completely: every registry facet is
 * either checkable or collected as unusable, and a single unusable facet
 * fails the whole run before a byte crosses the network. That ordering
 * is deliberate — asking the registry about a project that cannot say
 * what it currently has would spend the user's time to produce an answer
 * that still has to be thrown away.
 */
export async function discoverUpdates(args: DiscoverUpdatesArgs): Promise<DiscoverUpdatesResult> {
  const resolve = args.resolve ?? resolveRegistryMetadataBatch

  const slots: PlanSlot[] = []
  const pending: PendingFacet[] = []
  const unusable: UnusableFacetState[] = []

  for (const [name, entry] of Object.entries(args.facets)) {
    const source = entry.source
    const parsed = parseManifestFacetSource(name, source)
    if (!parsed.ok) {
      unusable.push({ name, reason: { code: 'unparseable-source', source, problem: parsed.error.what } })
      continue
    }

    if (parsed.value.kind !== 'registry') {
      slots.push({ kind: 'settled', row: { kind: 'unsupported-source', name, source, sourceKind: parsed.value.kind } })
      continue
    }

    const authored: AuthoredSpecifier = { source, spec: parsed.value.version }
    const locked = ownEntry(args.lockfile.facets, name)
    if (locked === undefined) {
      unusable.push({ name, reason: { code: 'missing-lock-entry' } })
      continue
    }
    if (locked.source.kind !== 'registry') {
      unusable.push({ name, reason: { code: 'lock-source-mismatch', locked: locked.source.kind } })
      continue
    }
    // Parsed here rather than through `parseLockedVersion`, which throws
    // on a value the lockfile schema was supposed to have narrowed. A
    // lockfile can be hand-edited; update reports that as a repairable
    // state instead of crashing out of a function that promises values.
    const current = parseExactVersion(locked.version)
    if (current === undefined) {
      unusable.push({ name, reason: { code: 'invalid-locked-version', version: locked.version } })
      continue
    }
    if (!satisfies(current, authored.spec)) {
      unusable.push({ name, reason: { code: 'locked-version-unsatisfying', version: locked.version, source } })
      continue
    }

    slots.push({ kind: 'pending' })
    pending.push({ name, authored, current })
  }

  if (unusable.length > 0) {
    return { ok: false, failure: { reason: 'unusable-facet-state', facets: unusable } }
  }

  const resolved = await resolvePendingFacets(pending, resolve)
  if (!resolved.ok) return resolved

  const plan: UpdatePlanRow[] = []
  let next = 0
  for (const slot of slots) {
    if (slot.kind === 'settled') {
      plan.push(slot.row)
      continue
    }
    const row = resolved.rows[next]
    next += 1
    if (row === undefined) return malformedBatch(pending.length * 2, next)
    plan.push(row)
  }

  return { ok: true, plan }
}

/**
 * Resolve both choices for every pending facet and classify the result.
 *
 * Each facet contributes two adjacent specifiers — its authored one for
 * Target, `latest` for Latest — so a full group of 100 covers 50 facets.
 * Groups are issued concurrently but inspected in order, which is what
 * makes the reported failure the same on every run no matter which
 * request happened to lose the race.
 */
async function resolvePendingFacets(
  pending: readonly PendingFacet[],
  resolve: ResolveMetadataBatch,
): Promise<{ ok: true; rows: readonly UpdatePlanRow[] } | { ok: false; failure: DiscoverUpdatesFailure }> {
  if (pending.length === 0) return { ok: true, rows: [] }

  const specs: RegistrySpec[] = []
  for (const facet of pending) {
    specs.push({ name: facet.name, version: facet.authored.spec })
    specs.push({ name: facet.name, version: { kind: 'latest' } })
  }

  const groups: RegistrySpec[][] = []
  for (let at = 0; at < specs.length; at += MAX_REGISTRY_METADATA_SPECIFIERS) {
    groups.push(specs.slice(at, at + MAX_REGISTRY_METADATA_SPECIFIERS))
  }

  const settled = await Promise.all(groups.map((group) => resolve(group)))

  const metadata: RegistryMetadata[] = []
  for (const group of settled) {
    if (!group.ok) return { ok: false, failure: { reason: 'discovery-failed', error: group.error } }
    metadata.push(...group.value)
  }

  const rows: UpdatePlanRow[] = []
  for (const [index, facet] of pending.entries()) {
    const targetMeta = metadata[index * 2]
    const latestMeta = metadata[index * 2 + 1]
    if (targetMeta === undefined || latestMeta === undefined) {
      return malformedBatch(specs.length, metadata.length)
    }

    const target = toChoice(facet.name, 'target', targetMeta)
    if (!target.ok) return target
    const latest = toChoice(facet.name, 'latest', latestMeta)
    if (!latest.ok) return latest

    if (!satisfies(target.choice.version, facet.authored.spec)) {
      return {
        ok: false,
        failure: {
          reason: 'target-outside-range',
          facet: facet.name,
          source: facet.authored.source,
          version: targetMeta.version,
        },
      }
    }

    rows.push(classify({ ...facet, target: target.choice, latest: latest.choice }))
  }

  return { ok: true, rows }
}

/**
 * The resolver returned a different number of results than it was asked
 * for. That is the boundary breaking its own contract rather than the
 * registry saying anything, so it surfaces as an unexpected error with
 * both counts rather than being attributed to a facet.
 */
function malformedBatch(requested: number, received: number): { ok: false; failure: DiscoverUpdatesFailure } {
  return {
    ok: false,
    failure: {
      reason: 'discovery-failed',
      error: {
        code: 'UNEXPECTED_ERROR',
        cause: `registry metadata resolution returned ${received} results for ${requested} requested specifiers`,
      },
    },
  }
}

/** Pair resolved metadata with its parsed exact version. */
function toChoice(
  facet: string,
  lookup: 'target' | 'latest',
  metadata: RegistryMetadata,
): { ok: true; choice: ResolvedChoice } | { ok: false; failure: DiscoverUpdatesFailure } {
  const version = parseExactVersion(metadata.version)
  if (version === undefined) {
    return { ok: false, failure: { reason: 'invalid-resolved-version', facet, lookup, version: metadata.version } }
  }
  return { ok: true, choice: { version, metadata } }
}

/**
 * Decide whether a resolved facet is a candidate, and for which choices.
 *
 * Only a strictly newer version counts, so a facet whose registry
 * answers moved backwards — an unpublished release, a narrower view of
 * the registry than the one that installed it — is reported as current
 * rather than offered as a downgrade.
 */
function classify(facet: CheckableRegistryFacet): UpdatePlanRow {
  const rangeAdvances = isNewerThan(facet.target.version, facet.current)
  const latestAdvances = isNewerThan(facet.latest.version, facet.current)
  if (!rangeAdvances && !latestAdvances) return { kind: 'current', facet }

  const advancing: AdvancingChoices =
    rangeAdvances && latestAdvances ? 'range-and-latest' : rangeAdvances ? 'range-only' : 'latest-only'
  return { kind: 'candidate', facet, advancing }
}
