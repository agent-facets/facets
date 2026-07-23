import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type ArchiveVerificationFailure,
  listVerifiedFiles,
  validateFacetArchive,
  verifiedFileHashes,
} from '@agent-facets/protocol'
import type { Client } from 'openapi-fetch'
import { createRegistryClient, translateWireError } from './client.ts'
import { resolveCredential } from './credentials.ts'
import type { paths } from './generated/registry-api.ts'
import { uncappedGunzip } from './gunzip.ts'
import { facetNameToRoute } from './http.ts'
import type { RegistryMetadata, RegistryResult } from './types.ts'

/**
 * Download a `.facet` archive from the registry and extract its verified
 * contents into `dest`.
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
 * Verification is two-layered:
 *   - **Transport**: sha256 of the downloaded bytes must match the
 *     registry's `transportHash`. Mismatch is a hard error — the
 *     tarball was tampered with in transit or the registry's record is
 *     corrupt; either way, refuse to extract.
 *   - **Content**: the downloaded bytes are passed through
 *     `validateFacetArchive` which runs the full end-to-end verification
 *     pipeline: outer-tar parsing, inner-archive decompression, per-asset
 *     hash reconciliation, path safety (`validateAssetName`), facet.json
 *     schema validation, outer-exclusivity (no undeclared extra files),
 *     and build-rule validation. Only verified assets are extracted.
 *
 * Always returns; never throws.
 */
/**
 * The verified-archive summary a successful download returns: the archive's
 * self-declared integrity and its version-selected per-entry hash map
 * (`assets` for legacy `0.1`, `files` for current `0.2`). Version-neutral
 * so cache verification does not branch on archive format.
 */
export interface DownloadedArchiveInfo {
  integrity: string
  fileHashes: Record<string, string>
}

/** Render an archive-verification failure as a short diagnostic string. */
function describeArchiveFailure(failure: ArchiveVerificationFailure): string {
  switch (failure.code) {
    case 'container':
    case 'invalid-json':
    case 'duplicate-members':
    case 'schema-violation':
    case 'validation':
      return failure.errors.map((e) => e.message).join('; ')
    case 'decompression':
      return failure.reason === 'too-large'
        ? 'inner archive exceeds the allowed decompressed size'
        : 'inner archive is not valid gzip (corrupt or truncated)'
    case 'integrity':
      return `archive integrity mismatch: expected ${failure.failure.expected}, got ${failure.failure.observed}`
    case 'entry-integrity':
      return failure.failures.map((f) => `entry ${f.path} hash mismatch`).join('; ')
    case 'unsupported-facet-version':
      return `unsupported archive format ${failure.observed ?? '(missing)'}`
    default: {
      const unreachable: never = failure
      throw new Error(`unreachable archive failure: ${JSON.stringify(unreachable)}`)
    }
  }
}

export async function downloadAndExtractFacet(
  meta: RegistryMetadata,
  dest: string,
): Promise<RegistryResult<DownloadedArchiveInfo>> {
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
  if (actualIntegrity !== meta.transportHash) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive sha256 mismatch: expected ${meta.transportHash}, got ${actualIntegrity}`,
        attempts: 1,
      },
    }
  }

  // Run the full end-to-end archive verification pipeline. This replaces
  // the former ad-hoc parseFacetArchive + parseTarGzip + sanitizeEntryName
  // extraction loop with the canonical validateFacetArchive, which runs
  // path-safety validation (validateAssetName), per-asset hash
  // reconciliation, outer-exclusivity (no undeclared extra files), and
  // build-rule validation. Only verified assets are extracted.
  const archiveResult = await validateFacetArchive(bytes, { gunzip: uncappedGunzip })
  if (!archiveResult.ok) {
    // An unsupported archive format is a typed failure so the CLI can
    // render actionable upgrade guidance instead of a generic error.
    if (archiveResult.failure.code === 'unsupported-facet-version') {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_ARCHIVE',
          observed: archiveResult.failure.observed,
          supported: archiveResult.failure.supported,
        },
      }
    }
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `archive is not a valid .facet: ${describeArchiveFailure(archiveResult.failure)}`,
        attempts: 1,
      },
    }
  }

  const verified = archiveResult.data

  // Extract every verified file to dest — primary assets and (for 0.2
  // archives) supplementary files alike. The cache slot is storage, not
  // materialization: archive-only files in a slot never reach materialize
  // because engine loaders only read the paths the manifest derives.
  // All paths were raw-header-validated as canonical relative paths.
  await mkdir(dest, { recursive: true })
  for (const file of listVerifiedFiles(verified)) {
    const target = join(dest, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.bytes)
  }

  return {
    ok: true,
    value: { integrity: verified.buildManifest.integrity, fileHashes: verifiedFileHashes(verified) },
  }
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
  // Scoped names use the two-segment scoped archive route so the scope `/`
  // is never collapsed into `%2F` (which the registry rejects).
  const route = facetNameToRoute(meta.name)
  try {
    const result =
      route.kind === 'scoped'
        ? await client.GET('/v0/facets/{scope}/{name}/{version}/archive', {
            params: { path: { scope: route.scope, name: route.name, version: meta.version } },
            redirect: 'manual',
          })
        : await client.GET('/v0/facets/{name}/{version}/archive', {
            params: { path: { name: route.name, version: meta.version } },
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
