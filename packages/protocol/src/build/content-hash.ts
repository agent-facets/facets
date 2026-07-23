import { createHash } from 'node:crypto'
import type { ValidationError } from '@agent-facets/common'
import { createTar, parseTar, type TarFileInput, type TarFileItem } from 'nanotar'
import {
  type BuildManifestParseFailure,
  type ParsedBuildManifest,
  parseBuildManifestDocument,
} from '../loaders/build-manifest.ts'
import { FACET_MANIFEST_FILE, type ResolvedFacetManifest } from '../loaders/facet.ts'
import { BUILD_MANIFEST_NAME, INNER_ARCHIVE_NAME } from '../schemas/build-manifest.ts'
import { validateRawTarEntries } from './tar-headers.ts'

// Outer-tar layout constants are defined beside the build-manifest schemas
// (which pin them) and re-exported here for assembly/parsing consumers.
export { BUILD_MANIFEST_NAME, INNER_ARCHIVE_NAME }

export interface ArchiveEntry {
  path: string
  /**
   * Entry payload. Primary text assets are strings; supplementary files are
   * opaque bytes written verbatim (design D6 — binary and empty permitted).
   * Hashing and tar assembly accept both.
   */
  content: string | Uint8Array
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
 * Structured failure data for outer-container parsing. Either the container
 * itself is malformed (`container`: raw-header violations, wrong entry set,
 * unparseable tar) or the embedded `build-manifest.json` failed versioned
 * parsing (all `BuildManifestParseFailure` variants pass through, including
 * the structured `unsupported-facet-version`).
 */
export type FacetArchiveParseFailure = { code: 'container'; errors: ValidationError[] } | BuildManifestParseFailure

export type ParseFacetArchiveResult =
  | { ok: true; data: { manifest: ParsedBuildManifest; innerArchiveBytes: Uint8Array } }
  | { ok: false; failure: FacetArchiveParseFailure }

/**
 * Reads the bytes of a `.facet` outer-tar archive and returns the embedded
 * build manifest (version-tagged) plus the compressed inner archive bytes.
 * Pure — no disk I/O.
 *
 * The outer container is validated STRICTLY before either entry is
 * selected (design D5): raw tar headers are checked for duplicate paths,
 * portable aliases, non-regular entries, and non-canonical names, and the
 * entry set must be exactly `{build-manifest.json, archive.tar.gz}` — so
 * parser collapse can never decide which entry is authoritative. The build
 * manifest is then parsed with exact `facetVersion` dispatch
 * (`parseBuildManifestDocument`): duplicate JSON members are rejected
 * before schema validation and unsupported versions return structured
 * failure data. The function never throws.
 *
 * To verify integrity on success, decompress the returned
 * `result.data.innerArchiveBytes` (e.g. via `node:zlib.gunzipSync`) and
 * pass the resulting tar bytes to `computeContentHash` — the result MUST
 * equal the parsed manifest's `integrity`.
 */
export function parseFacetArchive(bytes: Uint8Array): ParseFacetArchiveResult {
  // Raw-header validation before any selection: duplicates, aliases,
  // non-regular entries, and non-canonical names are rejected while the
  // full raw entry list still exists.
  const rawResult = validateRawTarEntries(bytes, '<archive>')
  if (!rawResult.ok) {
    return { ok: false, failure: { code: 'container', errors: rawResult.errors } }
  }

  // The canonical outer container holds exactly the two required entries.
  const observed = rawResult.entries.map((e) => e.path)
  const required = [BUILD_MANIFEST_NAME, INNER_ARCHIVE_NAME]
  const setErrors: ValidationError[] = []
  for (const name of required) {
    if (!observed.includes(name)) {
      setErrors.push({
        path: name,
        message: `Facet archive is missing required entry: ${name}`,
        expected: 'present in archive',
        actual: 'missing',
      })
    }
  }
  for (const name of observed) {
    if (!required.includes(name)) {
      setErrors.push({
        path: name,
        message: `Facet archive contains an unexpected outer entry: ${name}. The outer container holds exactly ${BUILD_MANIFEST_NAME} and ${INNER_ARCHIVE_NAME}.`,
        expected: `only ${BUILD_MANIFEST_NAME} and ${INNER_ARCHIVE_NAME}`,
        actual: 'unexpected entry',
      })
    }
  }
  if (setErrors.length > 0) {
    return { ok: false, failure: { code: 'container', errors: setErrors } }
  }

  let entries: TarFileItem[]
  try {
    entries = parseTar(bytes)
  } catch (e) {
    // Raw-header validation makes this near-unreachable, but nanotar's
    // throw-on-malformed contract is not ours — translate defensively.
    const message = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      failure: {
        code: 'container',
        errors: [
          {
            path: '<archive>',
            message: `Facet archive is not a valid tar file: ${message}`,
            expected: 'parseable tar archive',
            actual: 'malformed tar bytes',
          },
        ],
      },
    }
  }

  // Raw validation guarantees uniqueness, so first match is the only match.
  const manifestEntry = entries.find((entry) => entry.name === BUILD_MANIFEST_NAME)
  const innerEntry = entries.find((entry) => entry.name === INNER_ARCHIVE_NAME)
  const manifestBytes = manifestEntry?.data ? new Uint8Array(manifestEntry.data) : new Uint8Array(0)
  const innerBytes = innerEntry?.data ? new Uint8Array(innerEntry.data) : new Uint8Array(0)

  const manifestText = new TextDecoder().decode(manifestBytes)
  const manifestResult = parseBuildManifestDocument(manifestText)
  if (!manifestResult.ok) {
    return { ok: false, failure: manifestResult.failure }
  }

  return {
    ok: true,
    data: { manifest: manifestResult.data, innerArchiveBytes: innerBytes },
  }
}

/**
 * Reads the bytes of an inner archive tar (the *uncompressed* result of
 * gunzipping `archive.tar.gz`) and returns the per-asset entries.
 *
 * The caller is responsible for decompression (gzip is a delivery concern;
 * different gzip implementations produce different bytes but gunzip to
 * identical tars). Pass the gunzipped bytes here to enumerate the assets.
 *
 * Failure modes are part of the contract — the function never throws.
 * It returns `{ ok: false, errors }` when the input is malformed:
 *   - the bytes are not parseable as a tar archive
 *     (truncated, header size field out of range, etc.)
 *
 * Errors are reported as `ValidationError[]` rooted at the empty path
 * (the inner archive is the unit being parsed; there is no nested
 * subject to identify). Mirrors `parseFacetArchive`'s contract.
 */
export function parseInnerArchive(
  innerTarBytes: Uint8Array,
): { ok: true; entries: TarFileItem[] } | { ok: false; errors: ValidationError[] } {
  try {
    return { ok: true, entries: parseTar(innerTarBytes) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      errors: [
        {
          path: '',
          message: `Inner archive is not a valid tar file: ${message}`,
          expected: 'parseable tar archive',
          actual: 'malformed tar bytes',
        },
      ],
    }
  }
}
