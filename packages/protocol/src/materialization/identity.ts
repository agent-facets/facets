import type { AssetType, Scope } from '@agent-facets/common'
import { materializationNamespace } from './namespace.ts'

/**
 * Asset identity — the canonical derivation of an asset's archive paths and
 * of the two distinct keys that identify it during materialization.
 *
 * An asset has two identities that must not be conflated:
 *
 *   - **Authored identity** — the name the publisher declared. It fixes the
 *     asset's canonical inner-archive paths and therefore every integrity
 *     value. Aliasing and omission never change it.
 *   - **Effective identity** — the name the asset is materialized under. It
 *     equals the authored name unless the consuming project aliased it.
 *
 * The path helpers below are authored-domain: they take the authored name
 * and never see an alias. The key helpers are effective-domain: they take
 * whichever name the asset is actually materialized under.
 */

/**
 * Canonical asset-type ordering for deterministic output.
 *
 * Every ordered artifact — lockfile asset lists, collision groups, planner
 * results — sorts by this order and then by name, so identical inputs
 * always produce byte-identical output and diffs stay reviewable.
 */
export const ASSET_TYPE_ORDER: Readonly<Record<AssetType, number>> = {
  skill: 0,
  agent: 1,
  command: 2,
}

/** Comparator over asset types following {@link ASSET_TYPE_ORDER}. */
export function compareAssetTypes(a: AssetType, b: AssetType): number {
  return ASSET_TYPE_ORDER[a] - ASSET_TYPE_ORDER[b]
}

/**
 * Every asset type, in canonical order.
 *
 * Derived from {@link ASSET_TYPE_ORDER} rather than written out again, so a
 * new asset type cannot be given an order without also appearing in every
 * exhaustive iteration that walks this list.
 */
export const ASSET_TYPES: readonly AssetType[] = (Object.keys(ASSET_TYPE_ORDER) as AssetType[]).sort(compareAssetTypes)

/**
 * The inner-archive directory each asset type occupies.
 *
 * These strings double as the facet manifest's asset-group keys
 * (`skills`, `agents`, `commands`), so error messages that name a
 * declaration site derive the group from here rather than restating it.
 */
export const ASSET_DIRECTORY: Readonly<Record<AssetType, 'skills' | 'agents' | 'commands'>> = {
  skill: 'skills',
  agent: 'agents',
  command: 'commands',
}

/** The reserved primary file name inside a skill's bundle directory. */
export const SKILL_PRIMARY_FILE = 'SKILL.md'

/**
 * A skill's bundle directory, with a trailing slash. Every file a skill
 * owns — its primary and every declared companion — lives beneath this
 * prefix, which is what makes companion paths strippable back to
 * skill-relative form.
 */
export function skillRootPath(authoredName: string): string {
  return `${ASSET_DIRECTORY.skill}/${authoredName}/`
}

/**
 * The canonical inner-archive path of an asset's primary file, derived from
 * its AUTHORED name. Skills own a directory bundle; agents and commands are
 * single files.
 *
 * Integrity is anchored to these paths, so they are never derived from an
 * alias — an aliased skill's files stay under its authored `skills/<name>/`
 * prefix in both the archive and the lockfile.
 */
export function canonicalPrimaryPath(type: AssetType, authoredName: string): string {
  return type === 'skill'
    ? `${skillRootPath(authoredName)}${SKILL_PRIMARY_FILE}`
    : `${ASSET_DIRECTORY[type]}/${authoredName}.md`
}

/**
 * Portable collision key: canonical Unicode form (NFC) + case fold. Two
 * paths or names with the same key collide on at least one supported
 * filesystem.
 *
 * Shared by archive planning, raw tar-header validation, and cross-facet
 * materialization planning so every layer agrees on what "the same path"
 * means.
 *
 * This is `toLowerCase`, not full Unicode case folding (`ß` and `SS` do not
 * fold together). That is the rule the archive format has always applied;
 * widening it would reclassify already-published archives.
 */
export function portableCollisionKey(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

/**
 * Field separator for composite identity keys. NUL cannot appear in a
 * validated scope, asset type, namespace, or asset name, so no combination
 * of fields can be spelled two ways.
 */
const KEY_SEPARATOR = '\u0000'

/**
 * The LOGICAL uniqueness key: `(scope, namespace, portable effective name)`.
 *
 * Two assets collide when their collision keys are equal. Because the key
 * folds asset type into its namespace, a skill and a command claiming
 * `deploy` collide while an agent claiming `deploy` does not. Because the
 * name is folded portably, two assets that differ only by case or Unicode
 * normalization collide rather than silently overwriting each other on a
 * case-insensitive volume.
 *
 * This is NOT an addressable identity — it cannot be handed to an adapter.
 * Use {@link adapterKey} for that.
 */
export function collisionKey(scope: Scope, type: AssetType, effectiveName: string): string {
  return [scope, materializationNamespace(type), portableCollisionKey(effectiveName)].join(KEY_SEPARATOR)
}

/**
 * The CONCRETE addressable key: `(scope, type, effective name)`.
 *
 * Identifies the exact asset an adapter reads, writes, or deletes.
 * Deliberately keyed by asset type rather than namespace, and by the
 * verbatim effective name rather than a folded one: a skill `deploy` and a
 * command `deploy` are two different files on disk even though they may not
 * legally coexist, and ownership bookkeeping must address the name actually
 * written.
 */
export function adapterKey(scope: Scope, type: AssetType, effectiveName: string): string {
  return [scope, type, effectiveName].join(KEY_SEPARATOR)
}
