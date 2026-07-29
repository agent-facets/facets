import { type } from 'arktype'
import { validateAssetNameSegment } from './asset-name.ts'

/**
 * Materialization dispositions — how a consuming project chooses to
 * materialize one authored asset.
 *
 * Exactly three outcomes exist, and they are expressed as a tagged union so
 * no combination of fields can describe two of them at once:
 *
 *   - `authored` — materialize under the publisher's name. The default.
 *   - `aliased`  — materialize under a different effective name.
 *   - `omitted`  — do not materialize at all.
 *
 * A disposition changes ONLY the effective materialized identity. The
 * authored scope, type, canonical archive paths, and integrity values are
 * untouched by aliasing, and an omitted asset remains fully verified and
 * recorded in the lockfile.
 *
 * Two narrower variants are derived from the same three arms rather than
 * restated, so the arms cannot drift apart:
 *
 *   - `ProjectAssetOverride` (project intent, `facets.json`) admits only
 *     `aliased` and `omitted`. Authored materialization is expressed by the
 *     ABSENCE of an override, so an explicit `authored` override would be a
 *     second spelling of the default and is rejected.
 *   - `MaterializedDisposition` (resolved on-disk state, the receipt) admits
 *     only `authored` and `aliased`. An omitted asset is not materialized,
 *     so "omitted but present on disk" is unrepresentable.
 *
 * The TypeScript types are inferred from the schemas rather than written
 * separately and narrowed with `Exclude<>`: one source of truth means a
 * schema change cannot silently diverge from the type consumers rely on.
 */

/**
 * Reject an effective name on an arm that has no effective name. Arktype
 * objects tolerate unrecognized keys by default (deliberately, for
 * forward-compatible extension data), so `{ kind: 'authored', as: 'x' }`
 * would otherwise validate and quietly discard the alias.
 */
function rejectStrayEffectiveName(kind: string) {
  return (data: object, ctx: { mustBe: (expected: string) => false }): boolean =>
    Object.hasOwn(data, 'as') ? ctx.mustBe(`a "${kind}" disposition without an effective name`) : true
}

/** Materialize under the publisher's authored name. */
const AuthoredDisposition = type({ kind: "'authored'" }).narrow(rejectStrayEffectiveName('authored'))

/**
 * Materialize under a different effective name. `as` is REQUIRED — an
 * aliased disposition without a target is not a disposition at all — and
 * must satisfy the current single-segment asset-name grammar. An invalid
 * alias is rejected, never normalized or sanitized: silently rewriting a
 * user's chosen name would make the materialized identity unpredictable.
 */
const AliasedDisposition = type({ kind: "'aliased'", as: 'string' }).narrow((data, ctx) => {
  const check = validateAssetNameSegment(data.as)
  if (!check.ok) {
    return ctx.mustBe(`materialization alias "${data.as}" ${check.reason}`)
  }
  return true
})

/** Do not materialize this asset, or any file it owns. */
const OmittedDisposition = type({ kind: "'omitted'" }).narrow(rejectStrayEffectiveName('omitted'))

/** Every materialization outcome. Used wherever resolved state is recorded. */
export const MaterializationDispositionSchema = AuthoredDisposition.or(AliasedDisposition).or(OmittedDisposition)

/**
 * The subset a project manifest may record. Excludes `authored`, which is
 * expressed by omitting the override entirely.
 */
export const ProjectAssetOverrideSchema = AliasedDisposition.or(OmittedDisposition)

/**
 * The subset describing an asset actually present on disk. Excludes
 * `omitted`, which by definition materializes nothing.
 */
export const MaterializedDispositionSchema = AuthoredDisposition.or(AliasedDisposition)

/** Inferred type for any materialization disposition */
export type MaterializationDisposition = typeof MaterializationDispositionSchema.infer

/** Inferred type for a project-manifest materialization override */
export type ProjectAssetOverride = typeof ProjectAssetOverrideSchema.infer

/** Inferred type for the disposition of an asset that is materialized */
export type MaterializedDisposition = typeof MaterializedDispositionSchema.infer

/**
 * The name an asset is materialized under. Total by construction: the
 * parameter type excludes `omitted`, so there is no "no name" case to
 * represent with `undefined`.
 */
export function materializedNameOf(authoredName: string, disposition: MaterializedDisposition): string {
  return disposition.kind === 'aliased' ? disposition.as : authoredName
}

/**
 * Whether a disposition results in the asset being written at all.
 * Narrows to {@link MaterializedDisposition} so callers reach the effective
 * name without a second check.
 */
export function isMaterialized(disposition: MaterializationDisposition): disposition is MaterializedDisposition {
  return disposition.kind !== 'omitted'
}

/**
 * Whether two dispositions describe the same materialization outcome.
 *
 * Structural equality would compare `as` on arms that do not carry it, so
 * the comparison is arm-aware: only `aliased` has a target to disagree on.
 */
export function sameDisposition(a: MaterializationDisposition, b: MaterializationDisposition): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'aliased' && b.kind === 'aliased' ? a.as === b.as : true
}

/**
 * An independent copy of a disposition, preserving its arm.
 *
 * Producers that hand a disposition back to a caller must not hand back the
 * caller's own object: mutating an override after planning would otherwise
 * retroactively change a result that was computed from its old value,
 * leaving (for example) an alias target that disagrees with the effective
 * name and adapter key derived from it.
 *
 * Arm-aware rather than a structural deep clone, and overloaded rather than
 * generic, so the narrower input types survive the round trip — cloning a
 * `ProjectAssetOverride` cannot widen it into something that might be
 * `authored`. The `switch` is exhaustive, so a fourth arm fails to compile
 * here rather than silently copying nothing.
 */
export function cloneDisposition(disposition: ProjectAssetOverride): ProjectAssetOverride
export function cloneDisposition(disposition: MaterializedDisposition): MaterializedDisposition
export function cloneDisposition(disposition: MaterializationDisposition): MaterializationDisposition
export function cloneDisposition(disposition: MaterializationDisposition): MaterializationDisposition {
  switch (disposition.kind) {
    case 'authored':
      return { kind: 'authored' }
    case 'aliased':
      return { kind: 'aliased', as: disposition.as }
    case 'omitted':
      return { kind: 'omitted' }
  }
}
