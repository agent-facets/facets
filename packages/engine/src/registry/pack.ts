import { existsSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createTar } from 'nanotar'

/**
 * Pack a facet source directory into the V0 publish format: a gzipped
 * tar with `facet.json` at the root plus all conventional asset
 * directories (`skills/`, `agents/`, `commands/`) recursively.
 *
 * Other top-level files are skipped — they aren't part of the facet's
 * published surface and would just bloat the tarball
 * (node_modules, dist, .git, etc.).
 *
 * The output is the bytes the publish endpoint expects on the wire:
 * gunzip → tar containing facet.json at root.
 */
export async function packFacetSource(rootDir: string): Promise<Uint8Array<ArrayBuffer>> {
  const entries: Array<{ name: string; data: Uint8Array }> = []

  const manifestBytes = await readFile(join(rootDir, 'facet.json'))
  entries.push({ name: 'facet.json', data: new Uint8Array(manifestBytes) })

  for (const dirName of ['skills', 'agents', 'commands']) {
    const dirPath = join(rootDir, dirName)
    if (!existsSync(dirPath)) continue
    const stat = statSync(dirPath)
    if (!stat.isDirectory()) continue
    await collectFiles(dirPath, rootDir, entries)
  }

  // Bun.gzipSync and nanotar's createTar both return
  // Uint8Array<ArrayBufferLike> (the loose default), but downstream
  // consumers (the registry publish path, content-hash readers) expect
  // Uint8Array<ArrayBuffer> (the tight subtype). The runtime always
  // allocates a fresh ArrayBuffer-backed Uint8Array, so these casts
  // are type-only; they bridge Bun's still-evolving typed-array
  // generics to TypeScript's stricter variance check.
  const tar = createTar(entries) as Uint8Array<ArrayBuffer>
  return Bun.gzipSync(tar) as unknown as Uint8Array<ArrayBuffer>
}

async function collectFiles(
  dir: string,
  rootDir: string,
  out: Array<{ name: string; data: Uint8Array }>,
): Promise<void> {
  const items = await readdir(dir, { withFileTypes: true })
  for (const item of items) {
    const full = join(dir, item.name)
    if (item.isDirectory()) {
      await collectFiles(full, rootDir, out)
    } else if (item.isFile()) {
      const bytes = await readFile(full)
      out.push({ name: relative(rootDir, full), data: new Uint8Array(bytes) })
    }
  }
}
