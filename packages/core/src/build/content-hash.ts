import { createTar, type TarFileInput } from 'nanotar'
import { FACET_MANIFEST_FILE, type ResolvedFacetManifest } from '../loaders/facet.ts'

export interface ArchiveEntry {
  path: string
  content: string
}

/**
 * Computes a SHA-256 content hash of the given content.
 * Returns the hash in [ADR-4](https://www.notion.so/exmachina-co/ADR-4) format: `sha256:<hex>`.
 */
export function computeContentHash(content: string | Uint8Array): string {
  const hex = Bun.CryptoHasher.hash('sha256', content, 'hex')
  return `sha256:${hex}`
}

/**
 * Collects all files that belong in the archive from a resolved manifest.
 * Returns entries sorted lexicographically by path.
 *
 * The manifest content is read separately because the resolved manifest
 * is a parsed object — we need the original file content for the archive.
 */
export function collectArchiveEntries(resolved: ResolvedFacetManifest, manifestContent: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [{ path: FACET_MANIFEST_FILE, content: manifestContent }]

  if (resolved.skills) {
    for (const [name, skill] of Object.entries(resolved.skills)) {
      entries.push({ path: `skills/${name}/SKILL.md`, content: skill.prompt })
    }
  }

  if (resolved.agents) {
    for (const [name, agent] of Object.entries(resolved.agents)) {
      entries.push({ path: `agents/${name}.md`, content: agent.prompt })
    }
  }

  if (resolved.commands) {
    for (const [name, command] of Object.entries(resolved.commands)) {
      entries.push({ path: `commands/${name}.md`, content: command.prompt })
    }
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return entries
}

/**
 * Computes SHA-256 content hashes for each archive entry.
 * Returns a map of a relative path to `sha256:<hex>`.
 */
export function computeAssetHashes(entries: ArchiveEntry[]): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const entry of entries) {
    hashes[entry.path] = computeContentHash(entry.content)
  }
  return hashes
}

const DETERMINISTIC_ATTRS = {
  mtime: 0,
  uid: 0,
  gid: 0,
  mode: '644',
  user: '',
  group: '',
} as const

/**
 * Assembles a deterministic uncompressed tar archive from archive entries.
 *
 * Determinism is ensured by:
 * - Entries must be pre-sorted by path (caller responsibility via collectArchiveEntries)
 * - All metadata is zeroed: mtime=0, uid=0, gid=0, fixed mode, empty user/group
 *
 * The tar bytes are what gets content-hashed (the integrity value).
 * Compression is a separate delivery concern — see {@link compressArchive}.
 */
export function assembleTar(entries: ArchiveEntry[]): Uint8Array {
  const files: TarFileInput[] = entries.map((entry) => ({
    name: entry.path,
    data: entry.content,
  }))

  return createTar(files, { attrs: DETERMINISTIC_ATTRS })
}

/**
 * Compresses tar bytes with gzip for the inner archive.
 *
 * Compression is a delivery concern — the integrity hash covers the
 * uncompressed tar bytes, not the compressed output. This allows
 * changing compression algorithms without invalidating hashes.
 */
export function compressArchive(tarBytes: Uint8Array): Uint8Array {
  const buffer = new ArrayBuffer(tarBytes.byteLength)
  new Uint8Array(buffer).set(tarBytes)
  return Bun.gzipSync(buffer)
}

/** Fixed name for the inner archive within the outer `.facet` tar. */
export const INNER_ARCHIVE_NAME = 'archive.tar.gz'

/** Fixed name for the build manifest within the outer `.facet` tar. */
export const BUILD_MANIFEST_NAME = 'build-manifest.json'

/**
 * Assembles the outer uncompressed tar that forms the `.facet` file.
 *
 * The outer tar contains exactly two entries:
 * - `build-manifest.json` — the build manifest as a JSON string
 * - `archive.tar.gz` — the gzip-compressed inner tar of assets
 *
 * The outer tar is uncompressed so that the manifest can be read
 * without decompressing the inner archive.
 *
 * Deterministic metadata is applied for consistency, though the
 * integrity hash covers only the inner tar bytes.
 */
export function assembleOuterTar(manifestJson: string, innerArchiveBytes: Uint8Array): Uint8Array {
  const files: TarFileInput[] = [
    { name: BUILD_MANIFEST_NAME, data: manifestJson },
    { name: INNER_ARCHIVE_NAME, data: innerArchiveBytes },
  ]

  return createTar(files, { attrs: DETERMINISTIC_ATTRS })
}
