/**
 * Machine-local install receipt.
 *
 * The receipt records what this machine has materialized into each
 * project's adapter trees, separate from the lockfile. Because the
 * lockfile is shared and version-controlled, it cannot reliably
 * describe what a particular machine has on disk — a `git pull` can
 * remove a lockfile entry while that facet's assets remain materialized.
 *
 * One receipt file per project, stored under `$FACET_DIR/receipts/`.
 * The filename is `<basename>-<hash>.json` where `<hash>` is the first
 * 12 hex characters of `sha256(realpath(projectDir))`. The receipt
 * embeds the canonical project path for self-identification — a
 * mismatch on load fails closed (treated as absent, re-bootstrapped).
 *
 * Assets are stored as semantic tuples `{ scope, type, name }` — the
 * same adapter-agnostic shape as the lockfile. Deletion goes through
 * adapters, not raw filesystem paths. Name validation on load rejects
 * crafted names that could cause path traversal.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import { atomicWriteFileSync, validateAssetName } from '@agent-facets/common'
import type { Lockfile, LockfileAssetEntry } from '@agent-facets/protocol'
import { type } from 'arktype'
import { facetReceiptsDir } from '../facet-dir.ts'
import { jsonFileText } from '../json-file-text.ts'

// ---------------------------------------------------------------------------
// Versions (exact dispatch, mirroring the lockfile — design D10)
// ---------------------------------------------------------------------------

/**
 * The legacy receipt schema version. Numeric `1` identifies ONLY the previous
 * alpha shape: asset entries with no owned-file records. Legacy installs
 * could not materialize companions, so a legacy receipt is safely refined to
 * primary-only ownership on load. Version dispatch is exact, never ordered.
 */
export const LEGACY_RECEIPT_VERSION = 1

/**
 * The current receipt schema version. Current receipts mirror each committed
 * lockfile asset/file ownership set: every asset records the exact inner-
 * archive paths this machine materialized for it, so offline removal deletes
 * exactly the owned files. The receipt stores paths only — never adapter-
 * encoded hashes (design D10).
 */
export const CURRENT_RECEIPT_VERSION = 0.2

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * A current (`0.2`) receipt asset record: adapter-agnostic identity plus the
 * complete set of owned inner-archive file paths. A skill owns
 * `skills/<name>/SKILL.md` plus every materialized companion; an agent or
 * command owns exactly its single conventional primary file. Companion paths
 * are the engine-supplied `ownedCompanionPaths` handed to the adapter delete
 * request, so offline multi-file cleanup is exact.
 */
const CurrentReceiptAssetSchema = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
  files: 'string[]',
})

const CurrentReceiptFacetEntrySchema = type({
  version: 'string',
  assets: CurrentReceiptAssetSchema.array(),
})

const CurrentReceiptSchema = type({
  version: type.unit(CURRENT_RECEIPT_VERSION),
  path: 'string',
  facets: type.Record('string', CurrentReceiptFacetEntrySchema),
})

/** Legacy (`1`) receipt: identity-only asset tuples, no owned-file records. */
const LegacyReceiptAssetSchema = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
})

const LegacyReceiptFacetEntrySchema = type({
  version: 'string',
  assets: LegacyReceiptAssetSchema.array(),
})

const LegacyReceiptSchema = type({
  version: type.unit(LEGACY_RECEIPT_VERSION),
  path: 'string',
  facets: type.Record('string', LegacyReceiptFacetEntrySchema),
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A current receipt asset record with its owned inner-archive file paths.
 * Extends the adapter-agnostic identity so existing identity-only consumers
 * (which read `scope`/`type`/`name`) keep working while offline removal reads
 * `files` for exact owned-path deletion.
 */
export interface ReceiptAsset extends LockfileAssetEntry {
  files: string[]
}

export interface ReceiptFacetEntry {
  version: string
  assets: ReceiptAsset[]
}

export interface Receipt {
  version: typeof CURRENT_RECEIPT_VERSION
  path: string
  facets: Record<string, ReceiptFacetEntry>
}

/**
 * A receipt asset entry rejected during load because its name or one of its
 * owned file paths failed validation (path traversal, backslashes, empty
 * segments). Reported — never acted on — while the facet's remaining valid
 * entries still load (D6: a corrupted receipt may cause a skipped cleanup; it
 * must never poison the rest of the record). Because an invalid path could
 * escape the adapter's storage root, the whole asset record is dropped rather
 * than partially trusted — an unowned or escaping path is never deleted.
 */
export interface InvalidReceiptAsset {
  facet: string
  asset: string
  reason: string
}

export type LoadReceiptResult =
  | { ok: true; receipt: Receipt; invalidEntries: ReadonlyArray<InvalidReceiptAsset> }
  | { ok: false; reason: 'missing' | 'corrupt' | 'path-mismatch' }

// ---------------------------------------------------------------------------
// Path computation
// ---------------------------------------------------------------------------

const HASH_LENGTH = 12

/**
 * Compute the receipt file path for a project directory.
 *
 * The filename is `<basename>-<hash>.json` where:
 *   - `<basename>` is the last segment of the project dir (cosmetic)
 *   - `<hash>` is the first 12 hex characters of sha256(realpath)
 *
 * `realpath` is resolved before hashing so symlinked and case-variant
 * spellings of one project converge on one receipt. Two different
 * projects can only collide via SHA-256 truncation (negligible at 12
 * hex = 48 bits); the embedded-path check fails closed regardless.
 */
export function receiptPath(projectDir: string): string {
  const canonical = realpathSync(projectDir)
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, HASH_LENGTH)
  const slug = basename(canonical)
  return join(facetReceiptsDir(), `${slug}-${hash}.json`)
}

/**
 * Resolve the canonical (realpath) project directory. Exported so the
 * caller can pass the same value to both `loadReceipt` and
 * `writeReceipt` without re-resolving.
 */
export function canonicalProjectPath(projectDir: string): string {
  return realpathSync(projectDir)
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load the receipt for a project. Returns the parsed receipt on
 * success, or a structured failure reason:
 *
 *   - `missing`: no receipt file exists (first operation on this project)
 *   - `corrupt`: file exists but is unreadable, unparseable, or fails
 *     schema validation
 *   - `path-mismatch`: the receipt's embedded path does not match the
 *     current project's canonical path (collision, corruption, or the
 *     project was moved)
 *
 * Crafted asset NAMES (path traversal, backslashes) do NOT poison the
 * whole receipt: each invalid entry is extracted into `invalidEntries`
 * (facet, asset, reason) for the caller to report, while every valid
 * entry still loads and is processed normally. The returned receipt's
 * asset lists contain only validated names.
 *
 * Never throws.
 */
export function loadReceipt(projectDir: string): LoadReceiptResult {
  let canonical: string
  let filePath: string
  try {
    canonical = realpathSync(projectDir)
    filePath = receiptPath(projectDir)
  } catch {
    // realpathSync throws when the path doesn't exist or is otherwise
    // unresolvable (dangling symlink, permission denied). Treat the
    // same as a missing receipt — the caller will bootstrap a fresh one.
    return { ok: false, reason: 'corrupt' }
  }

  if (!existsSync(filePath)) {
    return { ok: false, reason: 'missing' }
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return { ok: false, reason: 'corrupt' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'corrupt' }
  }

  // Exact version dispatch (design D10): a current `0.2` receipt carries
  // owned-file records; a legacy `1` receipt is identity-only and is refined
  // to primary-only ownership (legacy installs could not materialize
  // companions). Any other/absent version is corrupt — the shape is never
  // sniffed to guess a schema.
  const observedVersion =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? (parsed as { version?: unknown }).version
      : undefined

  let embeddedPath: string
  let rawFacets: Record<string, { version: string; assets: ReadonlyArray<RawReceiptAsset> }>
  if (observedVersion === CURRENT_RECEIPT_VERSION) {
    const validated = CurrentReceiptSchema(parsed)
    if (validated instanceof type.errors) return { ok: false, reason: 'corrupt' }
    embeddedPath = validated.path
    rawFacets = validated.facets
  } else if (observedVersion === LEGACY_RECEIPT_VERSION) {
    const validated = LegacyReceiptSchema(parsed)
    if (validated instanceof type.errors) return { ok: false, reason: 'corrupt' }
    embeddedPath = validated.path
    // Refine legacy identity-only assets to primary-only owned-file sets:
    // the single conventional primary path per asset, no companions.
    rawFacets = {}
    for (const [name, entry] of Object.entries(validated.facets)) {
      rawFacets[name] = {
        version: entry.version,
        assets: entry.assets.map((a) => ({ ...a, files: [primaryPathFor(a)] })),
      }
    }
  } else {
    return { ok: false, reason: 'corrupt' }
  }

  // Self-identification check: the embedded path must match the
  // project being operated on.
  if (embeddedPath !== canonical) {
    return { ok: false, reason: 'path-mismatch' }
  }

  // Validate every asset name AND every owned file path — receipt data is
  // untrusted. A crafted name or a path that could traverse outside the
  // adapter's storage drops the whole asset record (reported, never
  // deleted), while the facet's remaining valid entries still load (D6).
  const invalidEntries: InvalidReceiptAsset[] = []
  const facets: Record<string, ReceiptFacetEntry> = {}
  for (const [facetName, entry] of Object.entries(rawFacets)) {
    const validAssets: ReceiptAsset[] = []
    for (const asset of entry.assets) {
      const nameCheck = validateAssetName(asset.name)
      if (!nameCheck.ok) {
        invalidEntries.push({ facet: facetName, asset: asset.name, reason: nameCheck.reason })
        continue
      }
      let badPath: { path: string; reason: string } | undefined
      for (const p of asset.files) {
        const check = validateAssetName(p)
        if (!check.ok) {
          badPath = { path: p, reason: check.reason }
          break
        }
      }
      if (badPath !== undefined) {
        invalidEntries.push({
          facet: facetName,
          asset: asset.name,
          reason: `owned path "${badPath.path}" ${badPath.reason}`,
        })
        continue
      }
      validAssets.push({ scope: asset.scope, type: asset.type, name: asset.name, files: [...asset.files] })
    }
    facets[facetName] = { version: entry.version, assets: validAssets }
  }

  return {
    ok: true,
    receipt: { version: CURRENT_RECEIPT_VERSION, path: canonical, facets },
    invalidEntries,
  }
}

/** The raw asset shape produced by version dispatch before path validation. */
interface RawReceiptAsset {
  scope: 'system' | 'user' | 'project'
  type: 'skill' | 'agent' | 'command'
  name: string
  files: ReadonlyArray<string>
}

/** The conventional primary inner-archive path for an asset identity. */
function primaryPathFor(asset: { type: 'skill' | 'agent' | 'command'; name: string }): string {
  switch (asset.type) {
    case 'skill':
      return `skills/${asset.name}/SKILL.md`
    case 'agent':
      return `agents/${asset.name}.md`
    case 'command':
      return `commands/${asset.name}.md`
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a receipt atomically. Creates the receipts directory if needed.
 *
 * The embedded `path` field is always normalized to `canonicalProjectPath(projectDir)`
 * regardless of what the passed `receipt` carries — this ensures the
 * receipt's self-identification matches what `loadReceipt` computes,
 * so a receipt can never round-trip to a spurious `path-mismatch`.
 *
 * Never throws on ENOENT for the parent directory.
 */
export function writeReceipt(projectDir: string, receipt: Receipt): void {
  const dir = facetReceiptsDir()
  mkdirSync(dir, { recursive: true })
  const filePath = receiptPath(projectDir)
  const canonical = canonicalProjectPath(projectDir)
  const normalized: Receipt = { ...receipt, path: canonical }
  atomicWriteFileSync(filePath, jsonFileText(normalized))
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Create a fresh current (`0.2`) receipt from a lockfile. Used when no
 * receipt exists (first operation on the project) or when the existing
 * receipt fails validation (path mismatch, corruption).
 *
 * Seeds from the lockfile's entries — records what *should* be on disk.
 * Owned file paths come from a `0.2` lockfile asset's `files[]`; a legacy
 * (identity-only) lockfile asset seeds the single conventional primary path
 * (legacy could not materialize companions). Assets orphaned before this
 * change shipped are unrecoverable (explicit non-goal in the proposal).
 */
export function bootstrapReceipt(projectDir: string, lockfile: Lockfile): Receipt {
  const canonical = realpathSync(projectDir)
  const facets: Record<string, ReceiptFacetEntry> = {}

  for (const [name, entry] of Object.entries(lockfile.facets)) {
    facets[name] = {
      version: entry.version,
      assets: entry.assets.map((a) => ({
        scope: a.scope,
        type: a.type,
        name: a.name,
        files: ownedPathsForLockedAsset(a),
      })),
    }
  }

  return { version: CURRENT_RECEIPT_VERSION, path: canonical, facets }
}

/**
 * Owned inner-archive paths for a locked asset. A `0.2` asset carries a
 * `files[]` array of `{ path, integrity }`; the receipt mirrors the paths
 * (no hashes). A legacy identity-only asset has no `files`, so the single
 * conventional primary path is used.
 */
export function ownedPathsForLockedAsset(asset: LockfileAssetEntry): string[] {
  const files = (asset as { files?: ReadonlyArray<{ path: string }> }).files
  if (Array.isArray(files) && files.length > 0) {
    return files.map((f) => f.path)
  }
  return [primaryPathFor(asset)]
}
