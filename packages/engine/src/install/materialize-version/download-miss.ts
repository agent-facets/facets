import { rm } from 'node:fs/promises'
import type { AssetIntegrityFailure } from '@agent-facets/protocol'
import { verifyRegistryThreeCheck } from '@agent-facets/protocol'
import { cachePutVerified, cacheStagingDir, computeDirIntegrity } from '../../cache/index.ts'
import type { CacheIdentity } from '../../cache/types.ts'
import { downloadAndExtractFacet } from '../../registry/download.ts'
import type { RegistryMetadata } from '../../registry/types.ts'
import type { ConfirmingMiss, LockedMiss, MaterializeVersionResult } from './types.ts'

/**
 * The cache-miss path (shared by locked-miss and confirming-miss):
 * download → genuine recompute → three-check → verified cache put.
 */
export async function handleMiss(input: LockedMiss | ConfirmingMiss): Promise<MaterializeVersionResult> {
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

  // Genuinely recompute the canonical integrity from the downloaded
  // bytes (per-asset hashes + canonical-tar hash). The manifest's
  // self-declared `integrity` is a CLAIM, not evidence — feeding it
  // back as `computedIntegrity` would make Check C compare the claim
  // against itself and pass unconditionally. The recompute is what
  // gives Check C teeth: tampered content whose manifest still carries
  // the original integrity now fails here.
  const recomputed = computeDirIntegrity(stagingDir, Object.keys(buildManifest.assets))
  if (!recomputed.ok) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    const failure: AssetIntegrityFailure = {
      kind: 'asset',
      facet: input.facetName,
      path: recomputed.path,
      expected: buildManifest.assets[recomputed.path] ?? '<unknown>',
      observed: '<missing>',
    }
    return { ok: false, code: 'integrity-failed', failure }
  }
  const computedIntegrity = recomputed.integrity

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
