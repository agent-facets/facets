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
 * mismatch on load fails closed, and a receipt that fails to load in
 * any way witnesses NOTHING rather than being projected from the
 * lockfile: the lockfile is shared state and cannot witness this
 * machine.
 *
 * Assets are stored as semantic tuples `{ scope, type, name }` — the
 * same adapter-agnostic shape as the lockfile. Deletion goes through
 * adapters, not raw filesystem paths. Name validation on load rejects
 * crafted names that could cause path traversal.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import { type AssetType, atomicWriteFileSync, type Scope, validateAssetName } from '@agent-facets/common'
import {
  canonicalPrimaryPath,
  isMaterialized,
  lockedDispositionOf,
  type MaterializedDisposition,
  MaterializedDispositionSchema,
  type SupportedLockfileAssetEntry,
  type SupportedLockfileFacet,
} from '@agent-facets/protocol'
import { type } from 'arktype'
import { facetReceiptsDir } from '../facet-dir.ts'
import { jsonFileText } from '../json-file-text.ts'
import { ownRecord } from './own-entry.ts'
import type { AssetIdentity } from './types.ts'

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
 * The preceding receipt schema version. Numeric `0.2` identifies ONLY the
 * shape with owned-file records but no materialization disposition: every
 * asset in a `0.2` receipt was materialized under its authored name.
 */
export const RECEIPT_VERSION_0_2 = 0.2

/**
 * The current receipt schema version.
 *
 * A current receipt records, for each asset actually present on disk: its
 * AUTHORED identity, the AUTHORED inner-archive paths it owns, and the
 * disposition under which it was materialized. Both names are needed for
 * offline deletion — the authored name anchors ownership and canonical
 * paths, the effective name is what the adapter must be asked to delete —
 * and neither can be derived from the other once a project aliases an
 * asset. The receipt stores paths only, never adapter-encoded hashes.
 *
 * Omitted assets never appear: a disposition here admits only the two arms
 * that put bytes on disk, which makes "omitted but materialized"
 * unrepresentable rather than merely unlikely.
 */
export const CURRENT_RECEIPT_VERSION = 0.3

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * A current (`0.3`) receipt asset record: authored identity, the complete
 * set of owned authored inner-archive file paths, and the materialization
 * disposition. A skill owns `skills/<name>/SKILL.md` plus every materialized
 * companion; an agent or command owns exactly its single conventional
 * primary file. Companion paths are the engine-supplied
 * `ownedCompanionPaths` handed to the adapter delete request, so offline
 * multi-file cleanup is exact.
 */
const CurrentReceiptAssetSchema = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
  materialization: MaterializedDispositionSchema,
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

/**
 * Preceding (`0.2`) receipt: owned-file records, no disposition. Every asset
 * is understood as materialized under its authored name.
 */
const Receipt02AssetSchema = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
  files: 'string[]',
})

const Receipt02FacetEntrySchema = type({
  version: 'string',
  assets: Receipt02AssetSchema.array(),
})

const Receipt02Schema = type({
  version: type.unit(RECEIPT_VERSION_0_2),
  path: 'string',
  facets: type.Record('string', Receipt02FacetEntrySchema),
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
 *
 * Built on its own shape, not a lockfile asset type: the receipt is
 * machine-local state with its own schema and its own version axis, and
 * inheriting a lockfile shape made it look like the two evolve together.
 * They do not.
 *
 * `name` is the AUTHORED name, and `files` are authored inner-archive paths;
 * the name on disk is derived by applying `materialization` to them. This is
 * deliberately NOT an {@link AssetIdentity}, whose `name` is effective —
 * handing a receipt asset to an adapter request would address the wrong file
 * for anything aliased, so the two shapes are kept unassignable.
 */
export interface ReceiptAsset {
  scope: Scope
  type: AssetType
  name: string
  /**
   * How this asset was materialized. Only the two arms that write bytes are
   * admissible — an omitted asset is absent from the receipt entirely.
   */
  materialization: MaterializedDisposition
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

/** Why this machine has no usable account of what it materialized. */
export type ReceiptUnavailableReason = 'missing' | 'corrupt' | 'path-mismatch'

/**
 * What this machine can prove it materialized.
 *
 * Two states, because there are only two answers: either a receipt file was
 * read and its validated claims ARE this machine's account of disk, or there
 * is no usable account and the proven ownership set is empty. The reasons an
 * account can be unusable differ in what to tell the user, never in how much
 * ownership they confer — a missing receipt and a corrupt one both prove
 * nothing, and the lockfile cannot stand in for either, because it is shared
 * state that a `git pull` rewrites without touching a single file on disk.
 *
 * The `unavailable` arm carries NO `Receipt`, deliberately. Every claim in a
 * receipt is a licence to delete, so a state that means "no claims" must not
 * be able to hold any: an empty-by-convention `Receipt` here would put the
 * whole guarantee on one constructor remembering to leave a field empty.
 * `canonicalProjectPath` is all the arm needs, because the only other use for
 * a receipt value is as the base a commit builds its NEW record on — and that
 * base is derived at commit time from the path (see `emptyReceiptFor`).
 */
export type ProjectReceiptState =
  /** Read from this machine's receipt file, and free to contradict the lockfile. */
  | { kind: 'loaded'; receipt: Receipt; invalidEntries: ReadonlyArray<InvalidReceiptAsset> }
  /** No trustworthy local account. Proven ownership is empty by construction. */
  | { kind: 'unavailable'; reason: ReceiptUnavailableReason; projectPath: string }

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
    // unresolvable (dangling symlink, permission denied). Nothing can be
    // witnessed without a canonical path to witness it against.
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

  // Exact version dispatch (design D10), mirroring the lockfile. Any
  // other/absent version is corrupt — the shape is never sniffed to guess a
  // schema. Each earlier version refines losslessly into the current shape:
  //
  //   `1`   — identity only. Refined to primary-only ownership, which is
  //           exact rather than a guess: legacy installs could not
  //           materialize companions, so there were none to record.
  //   `0.2` — complete ownership, no disposition. Refined to authored
  //           materialization, the only meaning a pre-disposition receipt
  //           could have had.
  const observedVersion =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? (parsed as { version?: unknown }).version
      : undefined

  const authored = { kind: 'authored' } as const

  let embeddedPath: string
  let rawFacets: Record<string, { version: string; assets: ReadonlyArray<RawReceiptAsset> }>
  if (observedVersion === CURRENT_RECEIPT_VERSION) {
    const validated = CurrentReceiptSchema(parsed)
    if (validated instanceof type.errors) return { ok: false, reason: 'corrupt' }
    embeddedPath = validated.path
    rawFacets = validated.facets
  } else if (observedVersion === RECEIPT_VERSION_0_2) {
    const validated = Receipt02Schema(parsed)
    if (validated instanceof type.errors) return { ok: false, reason: 'corrupt' }
    embeddedPath = validated.path
    rawFacets = ownRecord()
    for (const [name, entry] of Object.entries(validated.facets)) {
      rawFacets[name] = {
        version: entry.version,
        assets: entry.assets.map((a) => ({ ...a, materialization: authored })),
      }
    }
  } else if (observedVersion === LEGACY_RECEIPT_VERSION) {
    const validated = LegacyReceiptSchema(parsed)
    if (validated instanceof type.errors) return { ok: false, reason: 'corrupt' }
    embeddedPath = validated.path
    rawFacets = ownRecord()
    for (const [name, entry] of Object.entries(validated.facets)) {
      rawFacets[name] = {
        version: entry.version,
        assets: entry.assets.map((a) => ({
          ...a,
          materialization: authored,
          files: [canonicalPrimaryPath(a.type, a.name)],
        })),
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
  // Null-prototype throughout: a receipt facet key is an arbitrary string
  // from a file on disk, and dropping a `__proto__`-named facet here would
  // erase an ownership claim silently — the one outcome D6 rules out, since
  // the assets it covers would then never be deleted OR re-tracked.
  const invalidEntries: InvalidReceiptAsset[] = []
  const facets: Record<string, ReceiptFacetEntry> = ownRecord()
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
      validAssets.push({
        scope: asset.scope,
        type: asset.type,
        name: asset.name,
        materialization: asset.materialization,
        files: [...asset.files],
      })
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
  materialization: MaterializedDisposition
  files: ReadonlyArray<string>
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
// Resolution
// ---------------------------------------------------------------------------

/**
 * The disposition a locked asset was materialized under, or `undefined`
 * when it was not materialized at all.
 *
 * Only a `0.3` entry records a disposition; `0.2` predates the concept and
 * refines to authored. `undefined` means the asset is omitted —
 * it belongs in the lockfile, which records the resolved asset SET, but not
 * in the receipt, which records what is on disk.
 */
export function materializedDispositionOf(asset: SupportedLockfileAssetEntry): MaterializedDisposition | undefined {
  const disposition = lockedDispositionOf(asset)
  return isMaterialized(disposition) ? disposition : undefined
}

/**
 * Load this machine's account of what it materialized.
 *
 * A receipt that does not load confers no ownership, and this returns no
 * receipt value at all in that case. Projecting the lockfile here instead
 * would let shared state authorize deletion of files this machine has no
 * evidence it wrote.
 *
 * Never throws: an unresolvable project path is reported as `corrupt`, the
 * same as an unreadable file, because both leave nothing to witness with.
 */
export function resolveProjectReceipt(projectDir: string): ProjectReceiptState {
  const result = loadReceipt(projectDir)
  if (result.ok) return { kind: 'loaded', receipt: result.receipt, invalidEntries: result.invalidEntries }
  return { kind: 'unavailable', reason: result.reason, projectPath: bestEffortPath(projectDir) }
}

/**
 * The base a commit builds its new receipt on when there was no readable one.
 * Claims nothing: this run's writes are the only thing that may fill it.
 */
export function emptyReceiptFor(projectPath: string): Receipt {
  return { version: CURRENT_RECEIPT_VERSION, path: projectPath, facets: ownRecord() }
}

/**
 * The receipt base for whatever provenance a run has — the loaded record, or
 * an empty one. Never an ownership claim in the `unavailable` case.
 */
export function receiptBaseFor(state: ProjectReceiptState): Receipt {
  return state.kind === 'loaded' ? state.receipt : emptyReceiptFor(state.projectPath)
}

/**
 * Best-effort canonical path. An unresolvable project directory is already the
 * `corrupt` case, and `writeReceipt` normalizes the field again before it
 * reaches disk, so the un-canonicalized fallback never persists.
 */
function bestEffortPath(projectDir: string): string {
  try {
    return realpathSync(projectDir)
  } catch {
    return projectDir
  }
}

/**
 * The receipt entry a locked facet entry implies: every asset the lockfile
 * says was materialized, with the paths it says that asset owns.
 *
 * This is a CLAIM derived from shared state, not an observation of this
 * machine, so there is exactly ONE place it is true: recording a facet whose
 * assets this run just wrote from that very entry (`buildUpdatedReceipt`'s
 * `written` arm). Any other caller would be asserting ownership of files it
 * has no evidence for — the deletion authority that this receipt then hands
 * to the next run.
 *
 * Omitted assets are excluded: the lockfile records the resolved SET, the
 * receipt records what is on disk, and an omitted asset was never written.
 */
export function receiptEntryForLockedFacet(entry: SupportedLockfileFacet): ReceiptFacetEntry {
  const assets: ReceiptAsset[] = []
  for (const asset of entry.assets) {
    const materialization = materializedDispositionOf(asset)
    if (materialization === undefined) continue
    assets.push({
      scope: asset.scope,
      type: asset.type,
      name: asset.name,
      materialization,
      files: ownedPathsForLockedAsset(asset),
    })
  }
  return { version: entry.version, assets }
}

/**
 * Owned inner-archive paths for a locked asset.
 *
 * Every supported locked asset (`0.2` and `0.3`) carries a non-empty
 * `files[]` array of `{ path, integrity }` — the schema requires it — and
 * the receipt mirrors the paths, never the hashes. There is no
 * primary-only fallback here any more: the only identity-only lockfile
 * shape was the withdrawn `1`, which no longer loads. (Receipt version `1`
 * still refines to primary-only ownership; that is a separate format on a
 * separate axis, handled where receipts are loaded.)
 */
export function ownedPathsForLockedAsset(asset: SupportedLockfileAssetEntry): string[] {
  return asset.files.map((f) => f.path)
}
