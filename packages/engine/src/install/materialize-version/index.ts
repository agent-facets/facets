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
 *     genuinely recompute the canonical integrity from the downloaded
 *     bytes, run the three-check with `lockfileIntegrity`.
 *   - `confirming-miss`: cache miss + no lockfile entry. Download,
 *     genuinely recompute, run the three-check without a lockfile
 *     anchor.
 *
 * Module layout: `types.ts` (input/result unions), `audit-hit.ts`
 * (self-audit + external anchoring), `download-miss.ts` (download +
 * recompute + three-check + verified put).
 */

import { handleConfirmingHit, handleLockedHit } from './audit-hit.ts'
import { handleMiss } from './download-miss.ts'
import type { MaterializeVersionInput, MaterializeVersionResult } from './types.ts'

export type {
  ConfirmingHit,
  ConfirmingMiss,
  LockedHit,
  LockedMiss,
  MaterializeVersionInput,
  MaterializeVersionResult,
} from './types.ts'

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
