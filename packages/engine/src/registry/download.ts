import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative } from 'node:path'
import { parseTarGzip } from 'nanotar'
import type { Client } from 'openapi-fetch'
import { createRegistryClient, translateWireError } from './client.ts'
import { resolveCredential } from './credentials.ts'
import type { paths } from './generated/registry-api.ts'
import type { RegistryMetadata, RegistryResult } from './types.ts'

/**
 * Download a `.tar.gz` archive from the registry and extract its contents
 * into `dest`.
 *
 * The archive is fetched in two hops, both resolved here just-in-time
 * from the metadata's `name` + `version`:
 *
 *   1. A typed request to `GET /v0/facets/{name}/{version}/archive` with
 *      redirect-following disabled. The registry responds with a 302
 *      whose `Location` header is a short-lived presigned S3 URL. Routing
 *      this through the typed client keeps the registry request path
 *      inside the generated contract and lets the Bearer credential flow
 *      through the same middleware as every other registry call (so a
 *      future auth-on-archive change needs no new plumbing). Resolving it
 *      here — rather than at metadata time — means the presigned URL is
 *      minted at the last possible moment and cannot expire before use.
 *   2. A raw `fetch` of the presigned S3 URL for the bytes. This is the
 *      only request that is intentionally NOT routed through the typed
 *      client: a presigned S3 URL points at a different system and is
 *      never a registry endpoint in the OpenAPI spec.
 *
 * The downloaded bytes are a gzipped tarball with `facet.json` at the
 * root (the same shape `facet build` would produce before any `.facet`
 * outer-tar wrapping — V0 publishes the source distribution directly).
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
  // Reads carry the credential opportunistically (see design D3): the
  // archive-lookup request earns the authenticated rate-limit tier when
  // a credential is available, and proceeds anonymously otherwise.
  const cred = resolveCredential()
  const client = createRegistryClient({
    credential: cred.source === 'absent' ? undefined : cred.token,
  })

  const urlResult = await resolveArchiveUrl(client, meta)
  if (!urlResult.ok) return urlResult
  const archiveUrl = urlResult.value

  let response: Response
  try {
    response = await fetch(archiveUrl)
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive download failed: ${err instanceof Error ? err.message : String(err)}`,
        attempts: 1,
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
        attempts: 1,
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
        attempts: 1,
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
        attempts: 1,
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
        attempts: 1,
      },
    }
  }

  // Two-pass extraction to honor the all-or-nothing contract:
  //   Pass 1 — validate every entry's path. No filesystem writes. If any
  //            entry is unsafe, return immediately; `dest` is untouched.
  //   Pass 2 — only after every entry has cleared sanitization, mkdir
  //            `dest` and write the files.
  // Without the split, a malicious tar with a safe entry followed by an
  // unsafe one would land the safe entry on disk before we noticed.
  interface PreparedEntry {
    target: string
    data: Uint8Array
  }
  const prepared: PreparedEntry[] = []
  for (const entry of entries) {
    if (entry.data === undefined) continue // directory entry; recreated as we write files
    const safeName = sanitizeEntryName(entry.name)
    if (safeName === null) {
      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          cause: `archive contains an unsafe path: "${entry.name}"`,
          attempts: 1,
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
          attempts: 1,
        },
      }
    }
    prepared.push({ target, data: entry.data })
  }

  // All entries cleared sanitization — now it's safe to touch the filesystem.
  await mkdir(dest, { recursive: true })
  for (const { target, data } of prepared) {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }

  return { ok: true, value: undefined }
}

/**
 * Resolve the presigned archive URL for a facet version by issuing the
 * typed archive request with redirect-following disabled and reading
 * the `Location` header off the registry's 302.
 *
 * The request goes through the typed client (so it carries the Bearer
 * credential and stays inside the generated contract), but the response
 * is a redirect rather than a typed body — so we read the raw
 * `response` directly. A 200 here (the registry serving bytes inline
 * instead of redirecting) is also honored: in that case the archive URL
 * is the request URL itself, and the caller's raw fetch re-fetches it.
 */
export async function resolveArchiveUrl(
  client: Client<paths>,
  meta: RegistryMetadata,
): Promise<RegistryResult<string>> {
  let response: Response
  // openapi-fetch parses a non-2xx JSON body into `result.error` (the
  // body stream is consumed in the process), so we capture it here and
  // render it below rather than re-reading `response.json()`.
  let wireError: unknown
  try {
    const result = await client.GET('/v0/facets/{name}/{version}/archive', {
      params: { path: { name: meta.name, version: meta.version } },
      // Do not follow the redirect inside the typed client; we want to
      // read the presigned S3 URL off the `Location` header ourselves.
      redirect: 'manual',
    })
    response = result.response
    wireError = result.error
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        attempts: 1,
      },
    }
  }

  if (response.status === 404) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', name: meta.name, spec: meta.version },
    }
  }

  // A redirect (the expected V0 path): the Location header is the
  // presigned S3 URL.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (location === null || location.length === 0) {
      return {
        ok: false,
        error: {
          code: 'UNEXPECTED_ERROR',
          cause: `archive endpoint returned HTTP ${response.status} with no Location header`,
        },
      }
    }
    return { ok: true, value: location }
  }

  // A 2xx (the registry served the archive endpoint directly): the
  // archive URL is the request URL itself.
  if (response.ok) {
    return { ok: true, value: response.url }
  }

  // Any other status (401/403/5xx, etc.) is a registry rejection, not a
  // transport failure. Route the parsed envelope through
  // `translateWireError` so the registry's own `error`/`fix` text renders
  // verbatim (per the verbatim-error model), rather than flattening into
  // a generic NETWORK_ERROR. A body that isn't a well-formed envelope
  // (raw text, HTML 502, empty) yields UNPARSEABLE_RESPONSE via
  // `translateWireError`'s string/undefined handling. (404 is handled
  // above with the richer NOT_FOUND context, so it never reaches here.)
  //
  // The archive endpoint's OpenAPI declares no error response, so
  // `wireError` is typed `never`; cast through `unknown` to hand the
  // runtime body to `translateWireError` (same pattern as the search
  // read).
  return {
    ok: false,
    error: translateWireError(wireError as Parameters<typeof translateWireError>[0], response.status),
  }
}

/**
 * Reject tar entry names that would escape the extraction directory.
 * Returns the safe relative form, or null if the entry should be refused.
 *
 *   - Reject empty names.
 *   - Strip a leading `./`; if nothing remains, reject (no useful target).
 *   - Reject any platform-absolute path (`/foo`, `C:\foo`, `\\?\foo`,
 *     `\\server\share`). On POSIX `isAbsolute('C:\\...')` is false, so
 *     we also explicitly reject Windows-style drive letters and UNC
 *     prefixes — defense in depth in case a malicious tar is unpacked
 *     on a Windows host.
 *   - Reject any segment equal to `..` (parent traversal).
 *   - Reject `.` after normalization (entry would target `dest` itself,
 *     which `writeFile` cannot do because `dest` is a directory).
 */
function sanitizeEntryName(name: string): string | null {
  if (name.length === 0) return null
  let cleaned = name
  if (cleaned.startsWith('./')) cleaned = cleaned.slice(2)
  if (cleaned.length === 0) return null
  if (isAbsolute(cleaned)) return null
  // Windows drive letters and UNC, even on POSIX hosts where `isAbsolute`
  // returns false for them. (`C:\path`, `C:/path`, `\\server\share`.)
  if (/^[A-Za-z]:[\\/]/.test(cleaned)) return null
  if (cleaned.startsWith('\\\\')) return null
  if (cleaned.startsWith('/')) return null
  const normalized = normalize(cleaned)
  if (normalized === '.' || normalized === '..') return null
  const segments = normalized.split('/')
  if (segments.some((s) => s === '..')) return null
  return normalized
}
