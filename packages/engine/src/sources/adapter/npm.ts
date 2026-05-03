import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { parseTarGzip } from 'nanotar'

/**
 * Downloads an npm package to a temp directory.
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
 * @returns The path to the extracted package source directory.
 */
export async function downloadNpmPackage(packageName: string): Promise<string> {
  // Fetch package metadata from the npm registry
  const registryUrl = `https://registry.npmjs.org/${packageName}/latest`
  const metaResponse = await fetch(registryUrl)
  if (!metaResponse.ok) {
    throw new Error(`Failed to fetch npm package "${packageName}": ${metaResponse.status} ${metaResponse.statusText}`)
  }

  const meta = (await metaResponse.json()) as {
    dist?: { tarball?: string; integrity?: string; shasum?: string }
    version?: string
  }
  const tarballUrl = meta.dist?.tarball
  if (!tarballUrl) {
    throw new Error(`No tarball URL found for npm package "${packageName}"`)
  }

  // Download the tarball
  const tarballResponse = await fetch(tarballUrl)
  if (!tarballResponse.ok) {
    throw new Error(
      `Failed to download tarball for "${packageName}": ${tarballResponse.status} ${tarballResponse.statusText}`,
    )
  }

  const tarballBytes = new Uint8Array(await tarballResponse.arrayBuffer())

  // Integrity check. The registry normally ships `dist.integrity` (SRI);
  // older entries ship `dist.shasum` (hex sha1). Either is sufficient.
  verifyTarballIntegrity(packageName, tarballBytes, meta.dist?.integrity, meta.dist?.shasum)

  // Extract to a temp directory
  const tempDir = await mkdtemp(join(tmpdir(), 'facet-adapter-npm-'))
  const entries = await parseTarGzip(tarballBytes)

  for (const entry of entries) {
    if (!entry.data) continue

    // npm tarballs are wrapped in a `package/` directory
    const relativePath = entry.name.replace(/^package\//, '')
    if (!relativePath) continue

    const outputPath = join(tempDir, relativePath)
    assertInsideTempDir(tempDir, outputPath, packageName, entry.name)
    await Bun.write(outputPath, entry.data)
  }

  return tempDir
}

/**
 * Parse an SRI string (`sha512-<base64>`) and verify `bytes` hashes to the
 * expected digest. Falls back to `shasum` (hex sha1) when SRI is absent.
 * Throws on missing metadata — we refuse to install unhashed tarballs.
 *
 * Exported for direct unit-testing of the integrity and tar-slip guards
 * without standing up a whole fake registry + tarball pipeline.
 */
export function verifyTarballIntegrity(
  packageName: string,
  bytes: Uint8Array,
  integrity: string | undefined,
  shasum: string | undefined,
): void {
  if (integrity) {
    // SRI can contain multiple space-separated alternatives; one match is enough.
    for (const candidate of integrity.split(/\s+/).filter(Boolean)) {
      const dashIndex = candidate.indexOf('-')
      if (dashIndex === -1) continue
      const algo = candidate.slice(0, dashIndex)
      const expected = candidate.slice(dashIndex + 1)
      if (!SUPPORTED_SRI_ALGOS.has(algo)) continue
      const actual = createHash(algo).update(bytes).digest('base64')
      if (actual === expected) return
      throw new Error(
        `npm tarball integrity mismatch for "${packageName}" (${algo}): expected ${expected}, got ${actual}`,
      )
    }
    throw new Error(`npm tarball integrity for "${packageName}" uses no supported algorithm: "${integrity}"`)
  }

  if (shasum) {
    const actual = createHash('sha1').update(bytes).digest('hex')
    if (actual !== shasum) {
      throw new Error(`npm tarball shasum mismatch for "${packageName}": expected ${shasum}, got ${actual}`)
    }
    return
  }

  throw new Error(
    `npm registry returned no integrity or shasum for "${packageName}"; refusing to install untrusted bytes`,
  )
}

const SUPPORTED_SRI_ALGOS = new Set(['sha512', 'sha384', 'sha256', 'sha1'])

/**
 * Tar-slip defense. Asserts `outputPath` is contained inside `tempDir` (not
 * equal, not escaping via `..`, not absolute). Uses `path.relative` which
 * returns `..` segments when the target escapes. Exported for unit tests.
 */
export function assertInsideTempDir(tempDir: string, outputPath: string, packageName: string, entryName: string): void {
  if (isAbsolute(outputPath) === false) {
    // join() always produces an absolute path when tempDir is absolute, so
    // this is a defense-in-depth check only.
    throw new Error(`npm tarball entry "${entryName}" resolved to a relative path; refusing to extract`)
  }
  const rel = relative(tempDir, outputPath)
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).some((s) => s === '..')) {
    throw new Error(
      `npm tarball entry "${entryName}" for "${packageName}" escapes the extraction directory; refusing to install`,
    )
  }
}
