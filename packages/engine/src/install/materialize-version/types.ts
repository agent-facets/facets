import type { IntegrityFailure } from '@agent-facets/protocol'
import type { RegistryError } from '../../registry/types.ts'

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

/**
 * Outcome of the per-version materialization chain.
 *
 *   - `ok: true` → the slot holds verified content; `integrity` is the
 *     audited/recomputed canonical hash.
 *   - `lockfile-mismatch` → audited cache content contradicts the
 *     lockfile (hard failure, deliberately not self-healing).
 *   - `confirmation-mismatch` → audited cache content contradicts the
 *     registry's published fingerprint (Check A semantics).
 *   - `cache-tampered` → the slot failed its self-audit and HAS BEEN
 *     EVICTED; the caller may retry exactly once as a miss.
 *   - `download-failed` → archive resolution failed (network, 404,
 *     transport-hash mismatch).
 *   - `integrity-failed` → the three-check (or per-asset recompute)
 *     failed on downloaded content.
 */
export type MaterializeVersionResult =
  | { ok: true; slotPath: string; integrity: string }
  | { ok: false; code: 'lockfile-mismatch'; slotPath: string; expected: string; observed: string }
  | { ok: false; code: 'confirmation-mismatch'; expected: string; observed: string }
  | { ok: false; code: 'cache-tampered' }
  | { ok: false; code: 'download-failed'; error: RegistryError }
  | { ok: false; code: 'integrity-failed'; failure: IntegrityFailure }
