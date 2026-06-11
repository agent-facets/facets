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

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ReceiptAssetSchema = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
})

const ReceiptFacetEntrySchema = type({
  version: 'string',
  assets: ReceiptAssetSchema.array(),
})

const ReceiptSchema = type({
  version: '1',
  path: 'string',
  facets: type.Record('string', ReceiptFacetEntrySchema),
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReceiptFacetEntry {
  version: string
  assets: LockfileAssetEntry[]
}

export interface Receipt {
  version: 1
  path: string
  facets: Record<string, ReceiptFacetEntry>
}

export type LoadReceiptResult =
  | { ok: true; receipt: Receipt }
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
 *     schema validation (including crafted asset names)
 *   - `path-mismatch`: the receipt's embedded path does not match the
 *     current project's canonical path (collision, corruption, or the
 *     project was moved)
 *
 * Never throws.
 */
export function loadReceipt(projectDir: string): LoadReceiptResult {
  const canonical = realpathSync(projectDir)
  const filePath = receiptPath(projectDir)

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

  const validated = ReceiptSchema(parsed)
  if (validated instanceof type.errors) {
    return { ok: false, reason: 'corrupt' }
  }

  const receipt = validated as Receipt

  // Self-identification check: the embedded path must match the
  // project being operated on.
  if (receipt.path !== canonical) {
    return { ok: false, reason: 'path-mismatch' }
  }

  // Validate all asset names — reject crafted names that could cause
  // path traversal when passed to adapters.
  for (const [, entry] of Object.entries(receipt.facets)) {
    for (const asset of entry.assets) {
      if (!validateAssetName(asset.name).ok) {
        return { ok: false, reason: 'corrupt' }
      }
    }
  }

  return { ok: true, receipt }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a receipt atomically. Creates the receipts directory if needed.
 * Never throws on ENOENT for the parent directory.
 */
export function writeReceipt(projectDir: string, receipt: Receipt): void {
  const dir = facetReceiptsDir()
  mkdirSync(dir, { recursive: true })
  const filePath = receiptPath(projectDir)
  atomicWriteFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Create a fresh receipt from a lockfile. Used when no receipt exists
 * (first operation on the project) or when the existing receipt fails
 * validation (path mismatch, corruption).
 *
 * Seeds from the lockfile's entries — records what *should* be on
 * disk. Assets orphaned before this change shipped are unrecoverable
 * (explicit non-goal in the proposal).
 */
export function bootstrapReceipt(projectDir: string, lockfile: Lockfile): Receipt {
  const canonical = realpathSync(projectDir)
  const facets: Record<string, ReceiptFacetEntry> = {}

  for (const [name, entry] of Object.entries(lockfile.facets)) {
    facets[name] = {
      version: entry.version,
      assets: entry.assets.map((a) => ({ scope: a.scope, type: a.type, name: a.name })),
    }
  }

  return { version: 1, path: canonical, facets }
}
