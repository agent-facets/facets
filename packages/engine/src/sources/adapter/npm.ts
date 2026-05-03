import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { parseTarGzip } from 'nanotar'

/**
 * Discriminated result for `downloadNpmPackage`. The success arm
 * carries the path to the extracted package; each failure arm carries
 * the structured fields the CLI needs to render a precise message.
 *
 *   - `metadata-fetch-failed` — `GET <registry>/<name>/latest` failed
 *     at the HTTP level (network error or non-2xx status).
 *   - `no-tarball-url` — registry response lacked `dist.tarball`.
 *   - `tarball-fetch-failed` — `GET <tarball>` failed at the HTTP level.
 *   - `integrity-mismatch` — SRI/shasum check rejected the bytes.
 *   - `integrity-missing` — registry shipped neither SRI nor shasum;
 *     we refuse to install untrusted bytes.
 *   - `tar-slip` — a tarball entry's resolved path escapes the
 *     extraction directory (`..`-traversal or absolute path).
 */
export type DownloadNpmResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'metadata-fetch-failed'; packageName: string; status: number; statusText: string }
  | { ok: false; reason: 'metadata-network-error'; packageName: string; cause: string }
  | { ok: false; reason: 'no-tarball-url'; packageName: string }
  | { ok: false; reason: 'tarball-fetch-failed'; packageName: string; status: number; statusText: string }
  | { ok: false; reason: 'tarball-network-error'; packageName: string; cause: string }
  | { ok: false; reason: 'integrity-mismatch'; packageName: string; algo: string; expected: string; actual: string }
  | { ok: false; reason: 'integrity-unsupported-algo'; packageName: string; integrity: string }
  | { ok: false; reason: 'integrity-shasum-mismatch'; packageName: string; expected: string; actual: string }
  | { ok: false; reason: 'integrity-missing'; packageName: string }
  | { ok: false; reason: 'tar-slip'; packageName: string; entryName: string }

/**
 * Discriminated result for `verifyTarballIntegrity` — `{ ok: true }` on
 * pass, otherwise one of the integrity-related failure variants from
 * `DownloadNpmResult`. Exported for direct unit-testing without a fake
 * registry pipeline.
 */
export type VerifyTarballIntegrityResult =
  | { ok: true }
  | Extract<
      DownloadNpmResult,
      | { reason: 'integrity-mismatch' }
      | { reason: 'integrity-unsupported-algo' }
      | { reason: 'integrity-shasum-mismatch' }
      | { reason: 'integrity-missing' }
    >

/**
 * Discriminated result for `assertInsideTempDir`. Exported for direct
 * unit-testing of the tar-slip guard.
 */
export type AssertInsideTempDirResult = { ok: true } | Extract<DownloadNpmResult, { reason: 'tar-slip' }>

/**
 * Download an npm package to a temp directory.
 * Uses the npm registry API to resolve the tarball URL, then fetches and extracts it.
 *
 * F16 hardening:
 *  - Verifies the downloaded bytes against the registry's `dist.integrity`
 *    SRI string (Subresource Integrity, format: `sha<N>-<base64>`). Fails
 *    loud on mismatch so a compromised mirror or in-flight tamper is
 *    detectable. Supports sha512/sha384/sha256/sha1 (npm registry ships one).
 *  - Before writing each tarball entry, asserts the computed path stays
 *    inside `tempDir`. Rejects the whole package on any `..` or absolute
 *    traversal attempt (tar-slip).
 *
 * Returns a discriminated `DownloadNpmResult` — never throws on a
 * documented failure mode.
 */
export async function downloadNpmPackage(packageName: string): Promise<DownloadNpmResult> {
  // Fetch package metadata from the npm registry
  const registryUrl = `https://registry.npmjs.org/${packageName}/latest`
  let metaResponse: Response
  try {
    metaResponse = await fetch(registryUrl)
  } catch (e) {
    return {
      ok: false,
      reason: 'metadata-network-error',
      packageName,
      cause: e instanceof Error ? e.message : String(e),
    }
  }
  if (!metaResponse.ok) {
    return {
      ok: false,
      reason: 'metadata-fetch-failed',
      packageName,
      status: metaResponse.status,
      statusText: metaResponse.statusText,
    }
  }

  const meta = (await metaResponse.json()) as {
    dist?: { tarball?: string; integrity?: string; shasum?: string }
    version?: string
  }
  const tarballUrl = meta.dist?.tarball
  if (!tarballUrl) {
    return { ok: false, reason: 'no-tarball-url', packageName }
  }

  // Download the tarball
  let tarballResponse: Response
  try {
    tarballResponse = await fetch(tarballUrl)
  } catch (e) {
    return {
      ok: false,
      reason: 'tarball-network-error',
      packageName,
      cause: e instanceof Error ? e.message : String(e),
    }
  }
  if (!tarballResponse.ok) {
    return {
      ok: false,
      reason: 'tarball-fetch-failed',
      packageName,
      status: tarballResponse.status,
      statusText: tarballResponse.statusText,
    }
  }

  const tarballBytes = new Uint8Array(await tarballResponse.arrayBuffer())

  // Integrity check. The registry normally ships `dist.integrity` (SRI);
  // older entries ship `dist.shasum` (hex sha1). Either is sufficient.
  const integrityResult = verifyTarballIntegrity(packageName, tarballBytes, meta.dist?.integrity, meta.dist?.shasum)
  if (!integrityResult.ok) return integrityResult

  // Extract to a temp directory
  const tempDir = await mkdtemp(join(tmpdir(), 'facet-adapter-npm-'))
  const entries = await parseTarGzip(tarballBytes)

  for (const entry of entries) {
    if (!entry.data) continue

    // npm tarballs are wrapped in a `package/` directory
    const relativePath = entry.name.replace(/^package\//, '')
    if (!relativePath) continue

    const outputPath = join(tempDir, relativePath)
    const insideResult = assertInsideTempDir(tempDir, outputPath, packageName, entry.name)
    if (!insideResult.ok) return insideResult
    await Bun.write(outputPath, entry.data)
  }

  return { ok: true, path: tempDir }
}

/**
 * Parse an SRI string (`sha512-<base64>`) and verify `bytes` hashes to the
 * expected digest. Falls back to `shasum` (hex sha1) when SRI is absent.
 * Returns a structured failure when integrity metadata is missing — we
 * refuse to install unhashed tarballs.
 *
 * Exported for direct unit-testing of the integrity guard without
 * standing up a whole fake registry + tarball pipeline.
 */
export function verifyTarballIntegrity(
  packageName: string,
  bytes: Uint8Array,
  integrity: string | undefined,
  shasum: string | undefined,
): VerifyTarballIntegrityResult {
  if (integrity) {
    // SRI can contain multiple space-separated alternatives; one match is enough.
    for (const candidate of integrity.split(/\s+/).filter(Boolean)) {
      const dashIndex = candidate.indexOf('-')
      if (dashIndex === -1) continue
      const algo = candidate.slice(0, dashIndex)
      const expected = candidate.slice(dashIndex + 1)
      if (!SUPPORTED_SRI_ALGOS.has(algo)) continue
      const actual = createHash(algo).update(bytes).digest('base64')
      if (actual === expected) return { ok: true }
      return { ok: false, reason: 'integrity-mismatch', packageName, algo, expected, actual }
    }
    return { ok: false, reason: 'integrity-unsupported-algo', packageName, integrity }
  }

  if (shasum) {
    const actual = createHash('sha1').update(bytes).digest('hex')
    if (actual !== shasum) {
      return { ok: false, reason: 'integrity-shasum-mismatch', packageName, expected: shasum, actual }
    }
    return { ok: true }
  }

  return { ok: false, reason: 'integrity-missing', packageName }
}

const SUPPORTED_SRI_ALGOS = new Set(['sha512', 'sha384', 'sha256', 'sha1'])

/**
 * Tar-slip defense. Asserts `outputPath` is contained inside `tempDir` (not
 * equal, not escaping via `..`, not absolute). Uses `path.relative` which
 * returns `..` segments when the target escapes. Exported for unit tests.
 *
 * Returns a discriminated `AssertInsideTempDirResult`.
 */
export function assertInsideTempDir(
  tempDir: string,
  outputPath: string,
  packageName: string,
  entryName: string,
): AssertInsideTempDirResult {
  if (isAbsolute(outputPath) === false) {
    // join() always produces an absolute path when tempDir is absolute, so
    // this is a defense-in-depth check only.
    return { ok: false, reason: 'tar-slip', packageName, entryName }
  }
  const rel = relative(tempDir, outputPath)
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).some((s) => s === '..')) {
    return { ok: false, reason: 'tar-slip', packageName, entryName }
  }
  return { ok: true }
}
