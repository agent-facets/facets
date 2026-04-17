import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTarGzip } from 'nanotar'

/**
 * Downloads an npm package to a temp directory.
 * Uses the npm registry API to resolve the tarball URL, then fetches and extracts it.
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

  const meta = (await metaResponse.json()) as { dist?: { tarball?: string }; version?: string }
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

  // Extract to a temp directory
  const tempDir = await mkdtemp(join(tmpdir(), 'facet-adapter-npm-'))
  const entries = await parseTarGzip(tarballBytes)

  for (const entry of entries) {
    if (!entry.data) continue

    // npm tarballs are wrapped in a `package/` directory
    const relativePath = entry.name.replace(/^package\//, '')
    if (!relativePath) continue

    const outputPath = join(tempDir, relativePath)
    await Bun.write(outputPath, entry.data)
  }

  return tempDir
}
