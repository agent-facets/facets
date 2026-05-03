import type { Adapter } from '@agent-facets/adapter'
import { splitFrontMatter } from '@agent-facets/common'
import type { LockfileAssetEntry } from '@agent-facets/protocol'
import type { ResolvedFacetManifest } from '../loaders/facet.ts'
import type { InstallJournal } from './journal.ts'

/**
 * Compute the NEW asset set a facet contributes at this version. Derived
 * from the resolved build-time manifest (prompts already loaded).
 *
 * Default scope is `project`: facets live alongside a project's code, so
 * their assets should land in the project's adapter tree (e.g.
 * `<cwd>/.claude/skills/...`) rather than a user-wide location. Per-asset
 * scope overrides in the manifest are a roadmap item.
 *
 * The ordering (skills → agents → commands, alphabetical within each type)
 * is deterministic so lockfile diffs are stable across runs.
 */
export function computeAssetList(manifest: ResolvedFacetManifest): LockfileAssetEntry[] {
  const assets: LockfileAssetEntry[] = []

  for (const name of Object.keys(manifest.skills ?? {}).sort()) {
    assets.push({ scope: 'project', type: 'skill', name })
  }
  for (const name of Object.keys(manifest.agents ?? {}).sort()) {
    assets.push({ scope: 'project', type: 'agent', name })
  }
  for (const name of Object.keys(manifest.commands ?? {}).sort()) {
    assets.push({ scope: 'project', type: 'command', name })
  }

  return assets
}

/**
 * Diff OLD vs NEW asset sets. Returns the entries present in OLD but not in
 * NEW — those must be deleted from every adapter so on-disk state converges
 * with the freshly-installed version (drift-proof behavior).
 */
export function diffAssetsForDeletion(
  oldAssets: readonly LockfileAssetEntry[],
  newAssets: readonly LockfileAssetEntry[],
): LockfileAssetEntry[] {
  const newKeys = new Set(newAssets.map(assetKey))
  return oldAssets.filter((asset) => !newKeys.has(assetKey(asset)))
}

function assetKey(asset: LockfileAssetEntry): string {
  return `${asset.scope}:${asset.type}:${asset.name}`
}

export interface MaterializeOptions {
  manifest: ResolvedFacetManifest
  /** Adapters already filtered to those with supportsInstall === true. */
  adapters: Adapter[]
  /** Previous lockfile assets (OLD set); empty array when absent. */
  oldAssets: readonly LockfileAssetEntry[]
  newAssets: readonly LockfileAssetEntry[]
  journal: InstallJournal
  onLog?: (line: string) => void
}

/**
 * Outcome counts for one `materialize` call. Returned so the caller can
 * distinguish between "fully unchanged" (no writes) and "repaired"
 * (some assets needed to be re-written even though the facet's lockfile
 * entry didn't change — e.g., a user manually deleted the on-disk file).
 */
export interface MaterializeResult {
  /** Assets actually written to an adapter. Excludes skipped no-ops. */
  written: number
  /** Assets skipped because content + metadata matched on disk. */
  skipped: number
  /** Assets deleted (drift removal within this facet). */
  deleted: number
}

/**
 * Apply the install + delete operations across all selected adapters and
 * record inverse operations on the journal so a rollback can replay them.
 *
 * Per-asset, before writing, the adapter's current on-disk content is
 * compared to what we would write (content + metadata as JSON). If
 * identical, the write is skipped and no journal entry is recorded —
 * the asset was already in its desired state, and there's nothing to
 * undo. The skip count is reported in the returned `MaterializeResult`
 * so the caller can label outcomes accurately ("repaired" vs.
 * "unchanged") in summaries.
 *
 * Throws on the first adapter error; the caller is responsible for
 * driving rollback via `journal.rollback()` and emitting the failure.
 */
export async function materialize(opts: MaterializeOptions): Promise<MaterializeResult> {
  const toDelete = diffAssetsForDeletion(opts.oldAssets, opts.newAssets)
  let written = 0
  let skipped = 0
  let deleted = 0

  for (const adapter of opts.adapters) {
    // Adjustment S — runtime supportsInstall check (defense-in-depth beyond
    // the picker filter). Fail loud rather than silent no-op.
    if (adapter.supportsInstall !== true) {
      throw new Error(
        `adapter "${adapter.name}" does not support install (supportsInstall is absent or false). ` +
          `Update this adapter to a version with install support, or remove it with 'facet adapter remove ${adapter.name}'.`,
      )
    }

    for (const asset of opts.newAssets) {
      const content = contentFor(opts.manifest, asset)
      const metadata = buildAssetMetadata(opts.manifest, asset, adapter.name)

      // Capture original state for rollback (F14). A bare catch would treat
      // permission errors, I/O failures, and adapter bugs as "didn't exist",
      // so the journal's delete-undo could silently delete a pre-existing
      // asset we never read successfully. Narrow to ENOENT only and rethrow
      // everything else — install fails loud before we write anything.
      let previous: { content: string; metadata?: Record<string, unknown> } | null = null
      try {
        previous = await adapter.readAsset(asset.scope, asset.type, asset.name)
      } catch (err) {
        if (!isFileMissingError(err)) throw err
        previous = null
      }

      // Skip-if-identical: when the on-disk content + metadata already
      // matches what we would write, no work is needed and no journal
      // entry is recorded (there's nothing to undo).
      //
      // The candidate (`content`, `metadata`) we hand to `installAsset`
      // is NOT what lands on disk byte-for-byte. The adapter SDK's
      // `assembleAssetContent` splits any author-supplied front matter
      // out of `content` and merges it under the caller's `metadata`
      // (caller wins on key collisions), then re-emits a `--- yaml ---
      // body` file. To compare apples-to-apples with what `readAsset`
      // returns, we replay that merge here:
      //   - body is the post-split candidate body (via the same
      //     `splitFrontMatter` primitive the adapter SDK uses)
      //   - metadata is the same merge the SDK would do
      // The on-disk `previous.content` and `previous.metadata` reflect
      // that merged shape, so equality holds iff a no-op write is safe.
      //
      // We import `splitFrontMatter` from `common` rather than
      // `splitAssetContent` from the adapter SDK to keep the adapter SDK
      // a type-only dep of `core`: a value import from the SDK pulls
      // `yaml` into core's runtime graph and collides with `Bun.build`
      // when the CLI's adapter integration tests bundle the same source.
      const candidateSplit = splitFrontMatter(content)
      const mergedCandidateMetadata = { ...(candidateSplit.metadata ?? {}), ...metadata }
      if (
        previous &&
        previous.content === candidateSplit.content &&
        JSON.stringify(previous.metadata ?? {}) === JSON.stringify(mergedCandidateMetadata)
      ) {
        opts.onLog?.(`[verbose]   =${asset.type}:${asset.name} → ${adapter.name} (skipped)`)
        skipped++
        continue
      }

      opts.onLog?.(`[verbose]   +${asset.type}:${asset.name} → ${adapter.name}`)
      await adapter.installAsset(asset.scope, asset.type, asset.name, content, metadata)
      written++

      opts.journal.record({
        label: `install ${adapter.name}:${asset.type}:${asset.name}`,
        undo: async () => {
          if (previous) {
            await adapter.installAsset(asset.scope, asset.type, asset.name, previous.content, previous.metadata ?? {})
          } else {
            await adapter.deleteAsset(asset.scope, asset.type, asset.name)
          }
        },
      })
    }

    for (const asset of toDelete) {
      // Same F14 guard as the install branch above.
      let previous: { content: string; metadata?: Record<string, unknown> } | null = null
      try {
        previous = await adapter.readAsset(asset.scope, asset.type, asset.name)
      } catch (err) {
        if (!isFileMissingError(err)) throw err
        previous = null
      }

      opts.onLog?.(`[verbose]   -${asset.type}:${asset.name} → ${adapter.name}`)
      await adapter.deleteAsset(asset.scope, asset.type, asset.name)
      deleted++

      if (previous) {
        opts.journal.record({
          label: `delete ${adapter.name}:${asset.type}:${asset.name}`,
          undo: async () => {
            await adapter.installAsset(asset.scope, asset.type, asset.name, previous.content, previous.metadata ?? {})
          },
        })
      }
    }
  }

  return { written, skipped, deleted }
}

/**
 * ENOENT is the one "file didn't exist" signal we trust. Everything else —
 * EACCES, EIO, EISDIR, adapter bugs — means `previous` is unknown and the
 * journal must not record a delete-undo based on an assumption of absence.
 */
function isFileMissingError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  return code === 'ENOENT'
}

function contentFor(manifest: ResolvedFacetManifest, asset: LockfileAssetEntry): string {
  if (asset.type === 'skill') return manifest.skills?.[asset.name]?.prompt ?? ''
  if (asset.type === 'agent') return manifest.agents?.[asset.name]?.prompt ?? ''
  return manifest.commands?.[asset.name]?.prompt ?? ''
}

function descriptionFor(manifest: ResolvedFacetManifest, asset: LockfileAssetEntry): string {
  if (asset.type === 'skill') return manifest.skills?.[asset.name]?.description ?? ''
  if (asset.type === 'agent') return manifest.agents?.[asset.name]?.description ?? ''
  return manifest.commands?.[asset.name]?.description ?? ''
}

function adapterExtrasFor(
  manifest: ResolvedFacetManifest,
  asset: LockfileAssetEntry,
  adapterName: string,
): Record<string, unknown> | undefined {
  const adapters =
    asset.type === 'skill'
      ? manifest.skills?.[asset.name]?.adapters
      : asset.type === 'agent'
        ? manifest.agents?.[asset.name]?.adapters
        : manifest.commands?.[asset.name]?.adapters
  if (!adapters) return undefined
  const entry = adapters[adapterName]
  if (entry && typeof entry === 'object') return entry as Record<string, unknown>
  return undefined
}

/**
 * Build the front-matter metadata bag the adapter writes at the top of the
 * installed file. Every asset type gets `name` + `description` as the
 * required minimum (per user ask); adapter-specific extras from the
 * manifest's `adapters.<name>` block are merged underneath so computed
 * `name`/`description` always win — a facet cannot override the asset
 * identity via its adapter-extras block (F2 guard).
 */
function buildAssetMetadata(
  manifest: ResolvedFacetManifest,
  asset: LockfileAssetEntry,
  adapterName: string,
): Record<string, unknown> {
  return {
    ...(adapterExtrasFor(manifest, asset, adapterName) ?? {}),
    name: asset.name,
    description: descriptionFor(manifest, asset),
  }
}
