import { createRegistryClient, translateThrownError, translateWireError } from './client.ts'
import { describeVersionSpec } from './describe.ts'
import { encodeFacetName, getRegistryBaseUrl } from './http.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from './types.ts'

// Note on path-parameter encoding:
//
// `openapi-fetch` encodes path parameters automatically. Passing a
// pre-encoded value (e.g., `acme%2Fcowsay`) results in double-encoding
// (`acme%252Fcowsay`). So we pass the raw `spec.name` to
// `params.path.name` and `client.GET` does the right thing.
//
// `encodeFacetName` is still used below for the *derived* archive URL
// (which we build manually because the OpenAPI doesn't model the 302
// redirect target), where its single-encoding is correct.

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

  const client = createRegistryClient()
  const base = getRegistryBaseUrl()
  const results = await Promise.all(specs.map((spec) => fetchOne(client, base, spec)))
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

/**
 * Resolve a single `(name, version)` pair via the typed registry
 * client.
 *
 * The wire→internal mapping is intentional and load-bearing:
 *
 *   - `body.contentHash` becomes `expectedIntegrity` (renamed). It is
 *     the sha256 of the gzipped tarball as uploaded; downstream
 *     `download.ts` uses it for the bytes-level integrity check.
 *   - `tarballUrl` is *derived* — not on the wire — and is built from
 *     the **server-resolved** `body.version`, not the input spec. So
 *     a `latest` request that resolves to `0.1.0` produces
 *     `…/packages/<name>/0.1.0/archive`. This is critical: passing
 *     `versionForUrl` (the input spec) here would break the archive
 *     URL for any wildcard / `latest` request.
 */
async function fetchOne(
  client: ReturnType<typeof createRegistryClient>,
  base: string,
  spec: RegistrySpec,
): Promise<RegistryResult<RegistryMetadata>> {
  // Surface form ('1.2.3', '1.*', '*', 'latest', etc.) is sent verbatim.
  // The server is responsible for accepting/rejecting; we don't widen.
  const versionForUrl = describeVersionSpec(spec.version)

  try {
    const { data, error, response } = await client.GET('/v0/packages/{name}/{version}', {
      // Pass `spec.name` raw — openapi-fetch path-encodes it.
      params: { path: { name: spec.name, version: versionForUrl } },
    })

    if (error !== undefined) {
      return {
        ok: false,
        error: translateWireError(error, response.status, {
          name: spec.name,
          spec: describeVersionSpec(spec.version),
        }),
      }
    }

    // Compute the archive URL using the server-resolved version (in
    // case the input was `latest` or a wildcard). The archive URL is
    // built by hand (not by openapi-fetch) because the OpenAPI doesn't
    // model the 302 redirect target. `encodeFacetName` produces the
    // canonical npm-style %2F encoding for namespaced names.
    const encodedName = encodeFacetName(spec.name)
    const tarballUrl = `${base}/v0/packages/${encodedName}/${encodeURIComponent(data.version)}/archive`
    return {
      ok: true,
      value: {
        name: data.name,
        version: data.version,
        expectedIntegrity: data.contentHash,
        tarballUrl,
      },
    }
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}
