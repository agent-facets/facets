import { describeVersionSpec } from './describe.ts'
import { encodeFacetName, getRegistryBaseUrl } from './http.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from './types.ts'

/**
 * Wire-format response from `GET /v0/packages/:name/:version`. Mirrors the
 * osaka backend at `packages/v0/api/src/routes/fetch.ts` lines 134-144.
 *
 * `contentHash` is the sha256 of the gzipped tarball as it was uploaded;
 * we use it as `expectedIntegrity` on the metadata to anchor the download
 * verification. (See `download.ts` for the bytes-level check.)
 */
interface WireMetadataResponse {
  name: string
  version: string
  contentHash: string
  sizeBytes: number
  publishedAt: string
  manifestJson?: string
}

/**
 * Resolve registry metadata for a batch of `(name, version)` pairs.
 *
 * V0 fans out concurrent per-spec fetches (no batch endpoint server-side
 * yet). Returns one RegistryMetadata per input spec in input order, or
 * surfaces NOT_FOUND / NETWORK_ERROR for the first failure encountered —
 * all-or-nothing semantics keep the caller-side branching simple. (No
 * partial-failure surface area in V0; if the demo is the use case, a
 * single facet is being resolved at a time anyway.)
 *
 * Empty input returns `{ ok: true, value: [] }`.
 *
 * Version specs are sent verbatim in the form the user wrote (`1.2.3`,
 * `1.*`, `1.2.*`, `*`, `latest`). The server is the authority on which
 * forms it can resolve; the client must not silently widen a constrained
 * spec. V0 currently only resolves exact versions and `latest` — every
 * other form returns NOT_FOUND, which we surface unchanged. (Once the
 * server gains range-resolution support, this code does not need to
 * change.) The semantic correctness of the contract belongs on the
 * client; the limits of what's resolvable belong on the server.
 */
export async function resolveRegistryMetadataBatch(
  specs: ReadonlyArray<RegistrySpec>,
): Promise<RegistryResult<ReadonlyArray<RegistryMetadata>>> {
  if (specs.length === 0) return { ok: true, value: [] }

  const base = getRegistryBaseUrl()
  const results = await Promise.all(specs.map((spec) => fetchOne(base, spec)))
  for (const r of results) {
    if (!r.ok) return r
  }
  return {
    ok: true,
    value: results.map((r) => {
      // Type narrowing for the all-ok case.
      if (!r.ok) throw new Error('unreachable: failure should have short-circuited')
      return r.value
    }),
  }
}

async function fetchOne(base: string, spec: RegistrySpec): Promise<RegistryResult<RegistryMetadata>> {
  // Surface form ('1.2.3', '1.*', '*', 'latest', etc.) is sent verbatim.
  // The server is responsible for accepting/rejecting; we don't widen.
  const versionForUrl = describeVersionSpec(spec.version)
  const encodedName = encodeFacetName(spec.name)
  const url = `${base}/packages/${encodedName}/${encodeURIComponent(versionForUrl)}`
  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: err instanceof Error ? err.message : String(err),
      },
    }
  }
  if (response.status === 404) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', name: spec.name, spec: describeVersionSpec(spec.version) },
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `registry returned HTTP ${response.status} ${response.statusText}`,
      },
    }
  }
  let body: WireMetadataResponse
  try {
    body = (await response.json()) as WireMetadataResponse
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: `registry returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }
  if (typeof body.name !== 'string' || typeof body.version !== 'string' || typeof body.contentHash !== 'string') {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: 'registry response is missing required fields (name, version, contentHash)',
      },
    }
  }
  // Compute the archive URL the same way the metadata URL was computed,
  // but with the SERVER-RESOLVED version (in case the input was `latest`).
  const tarballUrl = `${base}/packages/${encodedName}/${encodeURIComponent(body.version)}/archive`
  return {
    ok: true,
    value: {
      name: body.name,
      version: body.version,
      expectedIntegrity: body.contentHash,
      tarballUrl,
    },
  }
}
