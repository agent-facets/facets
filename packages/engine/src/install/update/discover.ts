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
import { translateThrownError } from '../../registry/client.ts'
import { MAX_REGISTRY_METADATA_SPECIFIERS, resolveRegistryMetadataBatch } from '../../registry/resolve-metadata.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from '../../registry/types.ts'
import { ownEntry } from '../own-entry.ts'
import { parseManifestFacetSource } from '../parse-manifest-source.ts'
import { hasAdvancingChoice } from './advancing.ts'
import type { AuthoredSpecifier } from './manifest-source.ts'
import type {
  CheckableRegistryFacet,
  PrepareFacetUpdateFailure,
  ResolvedChoice,
  TargetVersion,
  UnusableFacetState,
  UpdatePlanRow,
} from './types.ts'
import { type ExactVersion, parseExactVersion } from './version-order.ts'

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
    if (row === undefined) return malformedBatch(pending.length, resolved.rows.length)
    plan.push(row)
  }

  return { ok: true, plan }
}

/**
 * Where each pending facet's answers sit in the flattened spec list.
 *
 * Tagged rather than an optional `targetAt`, because the two cases are
 * genuinely different requests: a pinned facet asks the registry one
 * question, everything else asks two. Carrying the offsets explicitly
 * is what lets facets with different lookup counts share one batch
 * without a stride the reader has to reconstruct.
 */
type PendingLookup =
  | { kind: 'pinned'; facet: PendingFacet; latestAt: number }
  | { kind: 'resolved'; facet: PendingFacet; targetAt: number; latestAt: number }

/**
 * Resolve the choices every pending facet still needs, and classify the
 * result.
 *
 * A facet contributes at most two specifiers — its authored one for
 * Target, `latest` for Latest — so a full group of 100 covers at least
 * 50 facets. An exact pin contributes only the second: its Target is
 * already known to be the installed version, and asking for it would
 * turn a yanked release into a project-wide discovery failure.
 *
 * Groups are issued concurrently. When more than one of them fails,
 * which failure comes back is deliberately not pinned down: every one of
 * them ends the run with no plan and the same instruction to the user, so
 * promising a particular one would constrain how these lookups are
 * batched and issued to buy a distinction nobody can act on.
 */
async function resolvePendingFacets(
  pending: readonly PendingFacet[],
  resolve: ResolveMetadataBatch,
): Promise<{ ok: true; rows: readonly UpdatePlanRow[] } | { ok: false; failure: DiscoverUpdatesFailure }> {
  if (pending.length === 0) return { ok: true, rows: [] }

  const specs: RegistrySpec[] = []
  const lookups: PendingLookup[] = []
  for (const facet of pending) {
    if (facet.authored.spec.kind === 'exact') {
      const latestAt = specs.push({ name: facet.name, version: { kind: 'latest' } }) - 1
      lookups.push({ kind: 'pinned', facet, latestAt })
      continue
    }
    const targetAt = specs.push({ name: facet.name, version: facet.authored.spec }) - 1
    const latestAt = specs.push({ name: facet.name, version: { kind: 'latest' } }) - 1
    lookups.push({ kind: 'resolved', facet, targetAt, latestAt })
  }

  const groups: RegistrySpec[][] = []
  for (let at = 0; at < specs.length; at += MAX_REGISTRY_METADATA_SPECIFIERS) {
    groups.push(specs.slice(at, at + MAX_REGISTRY_METADATA_SPECIFIERS))
  }

  // The resolver's contract is result-valued, but it is an injection
  // point and the real one reaches the network. A rejection here would
  // otherwise leave the command boundary as an unexplained exit 2, so
  // it is translated into the same structured failure a returned
  // network error produces.
  let settled: ReadonlyArray<RegistryResult<ReadonlyArray<RegistryMetadata>>>
  try {
    settled = await Promise.all(groups.map((group) => resolve(group)))
  } catch (err) {
    return { ok: false, failure: { reason: 'discovery-failed', error: translateThrownError(err) } }
  }

  const metadata: RegistryMetadata[] = []
  for (const group of settled) {
    if (!group.ok) return { ok: false, failure: { reason: 'discovery-failed', error: group.error } }
    metadata.push(...group.value)
  }

  const rows: UpdatePlanRow[] = []
  for (const lookup of lookups) {
    const facet = lookup.facet
    const latestMeta = metadata[lookup.latestAt]
    if (latestMeta === undefined) return malformedBatch(specs.length, metadata.length)
    const latest = toChoice(facet.name, 'latest', latestMeta)
    if (!latest.ok) return latest

    const target = resolveTarget(lookup, metadata)
    if (!target.ok) return target

    rows.push(classify({ ...facet, target: target.target, latest: latest.choice }))
  }

  return { ok: true, rows }
}

/**
 * The Target column for one facet: the pin it already has, or the
 * release the registry resolved its specifier to.
 *
 * Range satisfaction is checked only on the resolved arm. A pin's
 * Target is the locked version, which was already checked against the
 * same specifier before this facet became checkable at all.
 */
function resolveTarget(
  lookup: PendingLookup,
  metadata: readonly RegistryMetadata[],
): { ok: true; target: TargetVersion } | { ok: false; failure: DiscoverUpdatesFailure } {
  const facet = lookup.facet
  if (lookup.kind === 'pinned') {
    return { ok: true, target: { kind: 'pinned', version: facet.current } }
  }

  const targetMeta = metadata[lookup.targetAt]
  if (targetMeta === undefined) return malformedBatch(metadata.length + 1, metadata.length)
  const target = toChoice(facet.name, 'target', targetMeta)
  if (!target.ok) return target

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

  return { ok: true, target: { kind: 'resolved', ...target.choice } }
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
 * Decide whether a resolved facet has any decision to offer.
 *
 * Only a strictly newer version counts, so a facet whose registry
 * answers moved backwards — an unpublished release, a narrower view of
 * the registry than the one that installed it — is reported as current
 * rather than offered as a downgrade. Which of the two columns advances
 * is left to `advancingChoice`, so the plan carries the versions and one
 * predicate reads them.
 */
function classify(facet: CheckableRegistryFacet): UpdatePlanRow {
  return hasAdvancingChoice(facet) ? { kind: 'candidate', facet } : { kind: 'current', facet }
}
