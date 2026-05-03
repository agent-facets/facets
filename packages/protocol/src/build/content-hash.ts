import { createHash } from 'node:crypto'
import { createTar, parseTar, type TarFileInput, type TarFileItem } from 'nanotar'
import { FACET_MANIFEST_FILE, type ResolvedFacetManifest } from '../loaders/facet.ts'
import type { BuildManifest } from '../schemas/build-manifest.ts'

export interface ArchiveEntry {
  path: string
  content: string
}

/**
 * Computes a SHA-256 content hash of the given content.
 * Returns the hash in ADR-004 format: `sha256:<hex>`.
 */
export function computeContentHash(content: string | Uint8Array): string {
  const hex = createHash('sha256').update(content).digest('hex')
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

/**
 * Tar metadata fixed at known values so that build output is byte-identical
 * across builds, machines, and platforms. The integrity hash is computed
 * over these tar bytes, so any third-party producer that wants its
 * artifacts to interoperate MUST use the same metadata.
 */
export const DETERMINISTIC_ATTRS = {
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
 * Compression is a separate delivery concern — gzip output is NOT hashed,
 * and so `compressArchive` lives in engine, not protocol.
 */
export function assembleTar(entries: ArchiveEntry[]): Uint8Array {
  const files: TarFileInput[] = entries.map((entry) => ({
    name: entry.path,
    data: entry.content,
  }))

  return createTar(files, { attrs: DETERMINISTIC_ATTRS })
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

/**
 * Reads the bytes of a `.facet` outer-tar archive and returns the embedded
 * build manifest plus the compressed inner archive bytes. Pure — no disk I/O.
 *
 * Consumers (e.g., a registry receiving uploaded archives) call this to
 * inspect or verify an artifact without writing it to disk first. To
 * verify integrity, decompress the returned `innerArchiveBytes` (e.g. via
 * `node:zlib.gunzipSync`) and pass the resulting tar bytes to
 * `computeContentHash` — the result MUST equal `buildManifest.integrity`.
 */
export function parseFacetArchive(bytes: Uint8Array): { buildManifest: BuildManifest; innerArchiveBytes: Uint8Array } {
  const entries = parseTar(bytes)
  let manifestEntry: TarFileItem | undefined
  let innerEntry: TarFileItem | undefined
  for (const entry of entries) {
    if (entry.name === BUILD_MANIFEST_NAME) manifestEntry = entry
    else if (entry.name === INNER_ARCHIVE_NAME) innerEntry = entry
  }
  if (!manifestEntry?.data) {
    throw new Error(`Facet archive is missing required entry: ${BUILD_MANIFEST_NAME}`)
  }
  if (!innerEntry?.data) {
    throw new Error(`Facet archive is missing required entry: ${INNER_ARCHIVE_NAME}`)
  }
  const manifestText = new TextDecoder().decode(manifestEntry.data)
  const buildManifest = JSON.parse(manifestText) as BuildManifest
  return { buildManifest, innerArchiveBytes: new Uint8Array(innerEntry.data) }
}

/**
 * Reads the bytes of an inner archive tar (the *uncompressed* result of
 * gunzipping `archive.tar.gz`) and returns the per-asset entries.
 *
 * The caller is responsible for decompression (gzip is a delivery concern;
 * different gzip implementations produce different bytes but gunzip to
 * identical tars). Pass the gunzipped bytes here to enumerate the assets.
 */
export function parseInnerArchive(innerTarBytes: Uint8Array): TarFileItem[] {
  return parseTar(innerTarBytes)
}
