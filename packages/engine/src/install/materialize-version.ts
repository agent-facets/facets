/**
 * Shared per-version materialization chain.
 *
 * The commit orchestrator checks the cache and lockfile, then calls
 * `materializeVersion` with one of four input variants — each carrying
 * exactly the fields that path needs, nothing more.
 *
 * The four paths:
 *
 *   - `locked-hit`: cache hit + lockfile pins this version. Self-audit
 *     the cache, compare against the locked integrity. Fully offline.
 *   - `confirming-hit`: cache hit + no lockfile entry. Self-audit the
 *     cache, compare against the registry's `contentFingerprint`.
 *   - `locked-miss`: cache miss + lockfile pins this version. Download,
 *     run the three-check with `lockfileIntegrity`.
 *   - `confirming-miss`: cache miss + no lockfile entry. Download, run
 *     the three-check without a lockfile anchor.
 */

import { rm } from 'node:fs/promises'
import type { IntegrityFailure } from '@agent-facets/protocol'
import { verifyRegistryThreeCheck } from '@agent-facets/protocol'
import {
  auditCacheSlot,
  type CacheAuditResult,
  cachePutVerified,
  cacheStagingDir,
  evictCacheSlot,
  readCachedIntegrity,
} from '../cache/index.ts'
import type { CacheIdentity } from '../cache/types.ts'
import { downloadAndExtractFacet } from '../registry/download.ts'
import type { RegistryError, RegistryMetadata } from '../registry/types.ts'

// ---------------------------------------------------------------------------
// Input types — four-variant discriminated union
// ---------------------------------------------------------------------------

/** Cache hit, lockfile pins this version. Fully offline. */
export interface LockedHit {
  kind: 'locked-hit'
  facetName: string
  version: string
  slotPath: string
  lockfileIntegrity: string
}

/** Cache hit, no lockfile entry. Audited integrity compared against the
 *  registry's published canonical fingerprint. */
export interface ConfirmingHit {
  kind: 'confirming-hit'
  facetName: string
  version: string
  slotPath: string
  contentFingerprint: string
}

/** Cache miss, lockfile pins this version. Download + three-check. */
export interface LockedMiss {
  kind: 'locked-miss'
  facetName: string
  version: string
  transportHash: string
  contentFingerprint: string
  lockfileIntegrity: string
}

/** Cache miss, no lockfile entry. Download + three-check. */
export interface ConfirmingMiss {
  kind: 'confirming-miss'
  facetName: string
  version: string
  transportHash: string
  contentFingerprint: string
}

export type MaterializeVersionInput = LockedHit | ConfirmingHit | LockedMiss | ConfirmingMiss

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type MaterializeVersionResult =
  | { ok: true; slotPath: string; integrity: string }
  | { ok: false; code: 'lockfile-mismatch'; expected: string; observed: string }
  | { ok: false; code: 'confirmation-mismatch'; expected: string; observed: string }
  | { ok: false; code: 'cache-tampered' }
  | { ok: false; code: 'download-failed'; error: RegistryError }
  | { ok: false; code: 'integrity-failed'; failure: IntegrityFailure }

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Materialize a single registry facet version from cache or by
 * downloading it. The caller (commit orchestrator) has already
 * checked the cache and lockfile and constructed the appropriate
 * input variant.
 *
 * On success returns the cache slot path and verified integrity.
 * On failure returns a structured result — never throws.
 */
export async function materializeVersion(input: MaterializeVersionInput): Promise<MaterializeVersionResult> {
  switch (input.kind) {
    case 'locked-hit':
      return handleLockedHit(input)
    case 'confirming-hit':
      return handleConfirmingHit(input)
    case 'locked-miss':
      return handleMiss(input)
    case 'confirming-miss':
      return handleMiss(input)
  }
}

// ---------------------------------------------------------------------------
// Hit paths
// ---------------------------------------------------------------------------

function handleLockedHit(input: LockedHit): MaterializeVersionResult {
  return auditInput(input, (audit) => {
    // Integrity confirmation: audited integrity must equal the registry's
    // published canonical fingerprint.
    // Lockfile comparison: audited integrity must equal locked integrity.
    if (audit.integrity !== input.lockfileIntegrity) {
      return {
        ok: false,
        code: 'lockfile-mismatch',
        expected: input.lockfileIntegrity,
        observed: audit.integrity,
      }
    }

    return { ok: true, slotPath: input.slotPath, integrity: audit.integrity }
  })
}

function handleConfirmingHit(input: ConfirmingHit): MaterializeVersionResult {
  return auditInput(input, (audit) => {
    // Integrity confirmation: audited integrity must equal the registry's
    // published canonical fingerprint.
    if (audit.integrity !== input.contentFingerprint) {
      return {
        ok: false,
        code: 'confirmation-mismatch',
        expected: input.contentFingerprint,
        observed: audit.integrity,
      }
    }

    return { ok: true, slotPath: input.slotPath, integrity: audit.integrity }
  })
}

function auditInput(
  input: LockedHit | ConfirmingHit,
  onSuccess: (audit: Extract<CacheAuditResult, { ok: true }>) => MaterializeVersionResult,
): MaterializeVersionResult {
  const sidecar = readCachedIntegrity(input.slotPath)
  if (sidecar === null) {
    // Missing/corrupt sidecar — evict and report as tampered so the
    // orchestrator can retry as a miss with metadata.
    evictCacheSlot(input.slotPath)
    return { ok: false, code: 'cache-tampered' }
  }

  const audit = auditCacheSlot(input.slotPath, sidecar)
  if (!audit.ok) {
    evictCacheSlot(input.slotPath)
    return { ok: false, code: 'cache-tampered' }
  }

  return onSuccess(audit)
}

// ---------------------------------------------------------------------------
// Miss path (shared for locked-miss and confirming-miss)
// ---------------------------------------------------------------------------

async function handleMiss(input: LockedMiss | ConfirmingMiss): Promise<MaterializeVersionResult> {
  // Reconstruct the RegistryMetadata that downloadAndExtractFacet needs.
  const meta: RegistryMetadata = {
    name: input.facetName,
    version: input.version,
    transportHash: input.transportHash,
    contentFingerprint: input.contentFingerprint,
  }

  const stagingDir = cacheStagingDir()
  const downloadResult = await downloadAndExtractFacet(meta, stagingDir)
  if (!downloadResult.ok) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, code: 'download-failed', error: downloadResult.error }
  }

  // downloadAndExtractFacet returns the build manifest parsed from the
  // outer tar. The inner archive files are already extracted in stagingDir.
  const buildManifest = downloadResult.value
  const computedIntegrity = buildManifest.integrity

  // Run the registry three-check protocol.
  const threeCheck = verifyRegistryThreeCheck({
    facet: input.facetName,
    expectedIntegrity: input.contentFingerprint,
    archiveIntegrity: buildManifest.integrity,
    computedIntegrity,
    lockfileIntegrity: input.kind === 'locked-miss' ? input.lockfileIntegrity : undefined,
  })
  if (!threeCheck.ok) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, code: 'integrity-failed', failure: threeCheck.failure }
  }

  // Write to cache with per-asset audit + sidecar.
  const cacheId: CacheIdentity = { kind: 'registry', name: input.facetName, version: input.version }
  const putResult = cachePutVerified(cacheId, stagingDir, buildManifest, computedIntegrity, input.facetName)
  if (!putResult.ok) {
    // cachePutVerified failed — either corruption or integrity failure.
    // The staging dir may still exist if it was an integrity failure
    // (cachePutVerified doesn't clean up on integrity fail).
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    if ('integrity' in putResult) {
      return { ok: false, code: 'integrity-failed', failure: putResult.integrity }
    }
    // Corruption: the slot path has a non-directory squatter.
    return {
      ok: false,
      code: 'download-failed',
      error: {
        code: 'UNEXPECTED_ERROR',
        cause: `cache slot is corrupted (non-directory entry at ${putResult.corruption.slotPath})`,
      },
    }
  }

  return { ok: true, slotPath: putResult.path, integrity: computedIntegrity }
}
