import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ValidationError } from '@agent-facets/common'
import { type FacetManifest, planArchiveEntries } from '@agent-facets/protocol'
import { computeDirIntegrity } from '../cache/index.ts'

/**
 * The classified, hash-carrying result every facet-resolution path yields.
 *
 * A single source of truth for the `0.2` install pipeline:
 *
 *   - the lockfile's per-asset `files[]` records (this module),
 *   - pre-materialization per-file reconciliation (task 9.3),
 *   - skill-bundle materialization with owned-companion sets (task 9.6),
 *   - receipt ownership and offline multi-file removal (task 9.7).
 *
 * Two properties are load-bearing and jointly satisfied by
 * `buildVerifiedAssetPlan`:
 *
 *   1. **Single-source classification (design D3/D12).** Ownership — which
 *      companion belongs to which skill, and which entries are archive-only
 *      and therefore never materialized — comes from the protocol archive
 *      plan (`planArchiveEntries`), the same derivation the verifier uses.
 *      Engine never re-invents membership at this trust boundary.
 *   2. **Recomputed, not self-declared, integrity (design D10).** Every
 *      per-file hash is recomputed from the verified on-disk bytes via
 *      `computeDirIntegrity`, never copied from a build manifest's
 *      self-declared value.
 *
 * The plan deliberately carries NO bytes — only paths, hashes, and
 * ownership. Companion bytes needed for materialization (task 9.6) are read
 * from the verified slot on demand using these paths, so the plan stays a
 * lightweight integrity/ownership manifest rather than an in-memory copy of
 * the whole facet.
 */
export interface VerifiedAssetPlan {
  assets: VerifiedAsset[]
  /**
   * Archive-only supplementary entries (e.g. a root `README.md`). Pinned by
   * facet-level integrity but NEVER materialized to an adapter. Retained so
   * reconciliation can account for every inner-archive entry.
   */
  archiveOnly: VerifiedAssetFile[]
}

/**
 * One materialized asset: adapter-agnostic identity plus its complete set of
 * owned files. A skill owns `skills/<name>/SKILL.md` plus every declared
 * companion; an agent or command owns exactly its single conventional
 * primary file. The `files` array matches the `CurrentLockfileAsset` shape
 * (sorted by path, at least one record) so it can be written directly into a
 * `0.2` lockfile entry.
 */
export interface VerifiedAsset {
  scope: 'system' | 'user' | 'project'
  type: 'skill' | 'agent' | 'command'
  name: string
  files: VerifiedAssetFile[]
}

/** One owned file: canonical inner-archive path plus its recomputed hash. */
export interface VerifiedAssetFile {
  path: string
  integrity: string
}

export type BuildVerifiedAssetPlanResult =
  | { ok: true; plan: VerifiedAssetPlan }
  | { ok: false; errors: ValidationError[] }

/**
 * Derive the verified asset plan for a facet whose content lives in a
 * verified directory (a registry/git cache slot or a built local dir).
 *
 * All four resolve paths funnel through this one producer, so classification
 * and hashing happen in exactly one place regardless of source kind.
 *
 * `verifiedDir` MUST already be verified by the caller (cache self-audit,
 * three-check, or one-check) — this function recomputes per-file hashes over
 * its bytes but does not itself establish trust in the directory.
 */
export function buildVerifiedAssetPlan(manifest: FacetManifest, verifiedDir: string): BuildVerifiedAssetPlanResult {
  // 1. Classify every inner-archive entry via the shared protocol plan.
  const planResult = planArchiveEntries(manifest)
  if (!planResult.ok) {
    return { ok: false, errors: planResult.errors }
  }

  // 2. Recompute per-file hashes over the verified bytes for every entry
  //    except the embedded manifest (facet.json is not a materialized asset
  //    file and never appears in an asset's owned set).
  const hashPaths = planResult.data.filter((entry) => entry.kind !== 'manifest').map((entry) => entry.path)
  const recomputed = computeDirIntegrity(verifiedDir, hashPaths)
  if (!recomputed.ok) {
    return {
      ok: false,
      errors: [
        {
          path: recomputed.path,
          message:
            recomputed.reason === 'unreadable'
              ? `verified asset file could not be read: ${recomputed.path}`
              : `verified asset file has an unsafe path: ${recomputed.path}`,
          expected: recomputed.reason === 'unreadable' ? 'a readable file' : 'a safe canonical path',
          actual: recomputed.reason,
        },
      ],
    }
  }
  const hashFor = (path: string): string => {
    const hash = recomputed.assetHashes[path]
    // `computeDirIntegrity` succeeded over exactly `hashPaths`, so every
    // planned non-manifest path has a hash. This guard is defensive.
    if (hash === undefined) {
      throw new Error(`internal: missing recomputed hash for planned path "${path}"`)
    }
    return hash
  }

  // 3. Group primary assets with their owned companions; collect
  //    archive-only entries separately.
  const assetsByKey = new Map<string, VerifiedAsset>()
  const skillKeyByName = new Map<string, string>()
  const archiveOnly: VerifiedAssetFile[] = []

  for (const entry of planResult.data) {
    switch (entry.kind) {
      case 'manifest':
        break
      case 'primary-asset': {
        const key = `${entry.assetType}:${entry.name}`
        const asset: VerifiedAsset = {
          scope: 'project',
          type: entry.assetType,
          name: entry.name,
          files: [{ path: entry.path, integrity: hashFor(entry.path) }],
        }
        assetsByKey.set(key, asset)
        if (entry.assetType === 'skill') {
          skillKeyByName.set(entry.name, key)
        }
        break
      }
      case 'skill-companion': {
        const key = skillKeyByName.get(entry.skill)
        // `planArchiveEntries` only emits a skill-companion for a declared
        // skill, so the owning primary asset was already collected above.
        if (key === undefined) {
          throw new Error(`internal: companion "${entry.path}" references undeclared skill "${entry.skill}"`)
        }
        const owner = assetsByKey.get(key)
        if (owner === undefined) {
          throw new Error(`internal: missing owning asset for companion "${entry.path}"`)
        }
        owner.files.push({ path: entry.path, integrity: hashFor(entry.path) })
        break
      }
      case 'archive-only':
        archiveOnly.push({ path: entry.path, integrity: hashFor(entry.path) })
        break
    }
  }

  // 4. Sort each asset's files by path (the `CurrentLockfileAsset` narrow
  //    requires strict lexicographic ordering and rejects duplicates) and
  //    the asset list deterministically (skills → agents → commands, then by
  //    name) so lockfile diffs stay stable.
  const assets = [...assetsByKey.values()].sort(assetOrder)
  for (const asset of assets) {
    asset.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }
  archiveOnly.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return { ok: true, plan: { assets, archiveOnly } }
}

const TYPE_ORDER: Record<VerifiedAsset['type'], number> = { skill: 0, agent: 1, command: 2 }

function assetOrder(a: VerifiedAsset, b: VerifiedAsset): number {
  if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * A canonical map of skill companion paths (relative to the skill root) to
 * their exact bytes — the shape the adapter skill-install contract's
 * `companions` field expects. `SKILL.md` (the primary) is NOT included; it is
 * carried as the request's `content`.
 */
export type SkillCompanionBytes = Record<string, Uint8Array>

/**
 * Read the companion bytes for every skill in a verified asset plan from the
 * verified directory, keyed by `type:name` asset identity.
 *
 * Companion bytes are read verbatim (opaque `Uint8Array`) — never decoded or
 * front-matter processed. Paths are converted from the plan's full inner-
 * archive form (`skills/<name>/references/api.md`) to the skill-root-relative
 * form the adapter contract uses (`references/api.md`). Only skill assets with
 * companions beyond `SKILL.md` appear in the result; a companion-less skill
 * maps to an empty companion map.
 *
 * `verifiedDir` MUST be the same verified directory the plan was derived from.
 */
export function readSkillCompanionBytes(
  plan: VerifiedAssetPlan,
  verifiedDir: string,
): Map<string, SkillCompanionBytes> {
  const byAsset = new Map<string, SkillCompanionBytes>()
  for (const asset of plan.assets) {
    if (asset.type !== 'skill') continue
    const skillRoot = `skills/${asset.name}/`
    const primary = `skills/${asset.name}/SKILL.md`
    const companions: SkillCompanionBytes = {}
    for (const file of asset.files) {
      if (file.path === primary) continue
      // Every skill companion path is derived by `planArchiveEntries` to live
      // below the skill root, so this prefix strip is total.
      const relative = file.path.startsWith(skillRoot) ? file.path.slice(skillRoot.length) : file.path
      companions[relative] = new Uint8Array(readFileSync(join(verifiedDir, file.path)))
    }
    // Keyed by the `scope:type:name` identity `materialize` uses to look this
    // up. Companion bytes only exist for `project`-scoped skills today (the
    // only scope the plan mints), so the scope prefix is fixed.
    byAsset.set(`${asset.scope}:skill:${asset.name}`, companions)
  }
  return byAsset
}
