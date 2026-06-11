import { auditCacheSlot, type CacheAuditResult, evictCacheSlot, readCachedIntegrity } from '../../cache/index.ts'
import type { ConfirmingHit, LockedHit, MaterializeVersionResult } from './types.ts'

/**
 * The cache-hit paths: self-audit, then anchor externally.
 *
 * A cache hit is never taken at face value (design D4). The slot's
 * content is re-hashed against its integrity sidecar; a failed audit
 * (tampered bytes, missing/corrupt sidecar) EVICTS the slot and
 * reports `cache-tampered` so the orchestrator can retry as a miss.
 * After the self-audit the content is anchored externally: against the
 * locked integrity (locked-hit) or the registry's published canonical
 * fingerprint (confirming-hit).
 */

export function handleLockedHit(input: LockedHit): MaterializeVersionResult {
  return auditInput(input, (audit) => {
    // Lockfile comparison: audited integrity must equal locked
    // integrity. Catches a coordinated rewrite of cache bytes AND
    // sidecar, and enforces registry immutability client-side. A
    // mismatch is a hard failure, not a silent re-download.
    if (audit.integrity !== input.lockfileIntegrity) {
      return {
        ok: false,
        code: 'lockfile-mismatch',
        slotPath: input.slotPath,
        expected: input.lockfileIntegrity,
        observed: audit.integrity,
      }
    }

    return { ok: true, slotPath: input.slotPath, integrity: audit.integrity }
  })
}

export function handleConfirmingHit(input: ConfirmingHit): MaterializeVersionResult {
  return auditInput(input, (audit) => {
    // Integrity confirmation: audited integrity must equal the
    // registry's published canonical fingerprint (Check A semantics —
    // a lockfile entry is never created on trust).
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
