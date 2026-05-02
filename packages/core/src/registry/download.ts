import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, relative } from 'node:path'
import { parseTarGzip } from 'nanotar'
import type { RegistryMetadata, RegistryResult } from './types.ts'

/**
 * Download a `.tar.gz` archive from the registry and extract its contents
 * into `dest`.
 *
 * The V0 archive endpoint returns a 302 redirect to a presigned S3 URL;
 * `fetch` follows redirects by default so the call site doesn't need to
 * special-case it. The downloaded bytes are a gzipped tarball with
 * `facet.json` at the root (the same shape `facet build` would produce
 * before any `.facet` outer-tar wrapping — V0 publishes the source
 * distribution directly).
 *
 * Verification: the registry's `expectedIntegrity` (sha256 of the
 * tarball-as-uploaded) is checked against the bytes we just downloaded.
 * Mismatch is a hard error — the tarball was tampered with in transit
 * or the registry's record is corrupt; either way, refuse to extract.
 *
 * Path safety: tar entry names that would escape `dest` (absolute paths,
 * `../` segments, leading slashes) are rejected. A single bad entry
 * fails the entire extraction so we never end up with a half-written
 * directory containing some malicious files.
 *
 * Always returns; never throws.
 */
export async function downloadAndExtractFacet(meta: RegistryMetadata, dest: string): Promise<RegistryResult<void>> {
  let response: Response
  try {
    response = await fetch(meta.tarballUrl, { redirect: 'follow' })
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive download failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }
  if (response.status === 404) {
    // The archive endpoint and the metadata endpoint should agree on
    // existence, but if metadata succeeded and archive 404s the most
    // useful framing is still "not found" — the row exists but the
    // S3 object is missing (orphaned write).
    return {
      ok: false,
      error: { code: 'NOT_FOUND', name: meta.name, spec: meta.version },
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive download returned HTTP ${response.status} ${response.statusText}`,
      },
    }
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive read failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }

  // Integrity check before any extraction. If the bytes are not what the
  // registry told us they would be, do NOT touch the filesystem.
  const actualIntegrity = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  if (actualIntegrity !== meta.expectedIntegrity) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive sha256 mismatch: expected ${meta.expectedIntegrity}, got ${actualIntegrity}`,
      },
    }
  }

  let entries: ReadonlyArray<{ name: string; data?: Uint8Array }>
  try {
    entries = await parseTarGzip(bytes)
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive is not a valid gzipped tar: ${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }

  // Make sure dest exists; mkdir -p is idempotent.
  await mkdir(dest, { recursive: true })

  for (const entry of entries) {
    if (entry.data === undefined) continue // directory entry; recreated as we write files
    const safeName = sanitizeEntryName(entry.name)
    if (safeName === null) {
      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          cause: `archive contains an unsafe path: "${entry.name}"`,
        },
      }
    }
    const target = join(dest, safeName)
    // Defense-in-depth: ensure the resolved path is still under dest after
    // join+normalize. `sanitizeEntryName` should have caught this, but
    // a second check costs nothing.
    const rel = relative(dest, target)
    if (rel.startsWith('..') || rel.startsWith('/')) {
      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          cause: `archive entry "${entry.name}" resolves outside the extraction directory`,
        },
      }
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entry.data)
  }

  return { ok: true, value: undefined }
}

/**
 * Reject tar entry names that would escape the extraction directory.
 * Returns the safe relative form, or null if the entry should be refused.
 *
 *   - Strip a leading `./`.
 *   - Reject leading `/` (absolute path).
 *   - Reject any segment equal to `..` (parent traversal).
 *   - Reject empty names.
 */
function sanitizeEntryName(name: string): string | null {
  if (name.length === 0) return null
  let cleaned = name
  if (cleaned.startsWith('./')) cleaned = cleaned.slice(2)
  if (cleaned.startsWith('/')) return null
  const normalized = normalize(cleaned)
  const segments = normalized.split('/')
  if (segments.some((s) => s === '..')) return null
  return normalized
}
