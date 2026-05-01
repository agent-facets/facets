import type { RegistryMetadata, RegistryResult } from './types.ts'

/**
 * Download a `.facet` tarball from the registry and extract its
 * contents into `dest`.
 *
 * Today this function is a stub: it returns `REGISTRY_NOT_AVAILABLE`
 * for every call and delegates the user toward git/local sources
 * until the real registry ships.
 *
 * Tomorrow's implementation will:
 *
 *   1. Fetch the tarball bytes from `meta.tarballUrl`.
 *   2. Run the dual-extraction:
 *        - outer tar (uncompressed): contains `build-manifest.json`
 *          and `archive.tar.gz`.
 *        - inner tar (gzipped): the actual facet content.
 *   3. Verify the inner archive's self-declared integrity matches the
 *      outer manifest's claim, then matches `meta.expectedIntegrity`
 *      (Checks B and C of the three-check protocol).
 *   4. Write the extracted content into `dest`.
 *
 * The integrity verification belongs to the caller (it's the bridge
 * between this function's bytes and the lockfile's recorded hash);
 * `downloadAndExtractFacet` produces the bytes and returns.
 *
 * Always returns; never throws.
 */
export async function downloadAndExtractFacet(
  meta: RegistryMetadata,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: stub; will be used by the real implementation
  dest: string,
): Promise<RegistryResult<void>> {
  // TODO(registry): replace with real .facet tarball fetch + extraction.
  return {
    ok: false,
    error: {
      code: 'REGISTRY_NOT_AVAILABLE',
      what: `registry tarball download is not yet available (would fetch ${meta.tarballUrl} for ${meta.name}@${meta.version})`,
      fix: 'use a github: shortcut, https URL, ssh URL, or local path until the registry ships',
    },
  }
}
