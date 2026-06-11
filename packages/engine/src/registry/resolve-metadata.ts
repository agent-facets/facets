import { createRegistryClient, translateThrownError, translateWireError } from './client.ts'
import { resolveCredential } from './credentials.ts'
import { describeVersionSpec } from './describe.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from './types.ts'

// Note on path-parameter encoding:
//
// `openapi-fetch` encodes path parameters automatically. Passing a
// pre-encoded value (e.g., `acme%2Fcowsay`) results in double-encoding
// (`acme%252Fcowsay`). So we pass the raw `spec.name` to
// `params.path.name` and `client.GET` does the right thing.

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

  // Reads carry the credential opportunistically: when one is
  // available it earns the authenticated rate-limit tier; when absent
  // the reads proceed anonymously (see design D3).
  const cred = resolveCredential()
  const client = createRegistryClient({
    credential: cred.source === 'absent' ? undefined : cred.token,
  })
  const results = await Promise.all(specs.map((spec) => fetchOne(client, spec)))
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
 *   - `body.content_hash` becomes `transportHash`. It is the sha256 of
 *     the gzipped tarball as uploaded; `download.ts` uses it for the
 *     raw-bytes transport check.
 *   - `body.content_integrity` becomes `contentFingerprint`. It is the
 *     sha256 of the canonical archive (inner uncompressed tar) — the
 *     domain the sidecar, lockfile, and build-manifest all record. Fed
 *     to the three-check protocol as `expectedIntegrity` and used for
 *     integrity confirmation when creating a lockfile entry.
 *
 * No archive URL is computed here. The archive request is issued
 * just-in-time by `downloadAndExtractFacet` from the resolved
 * `name` + `version` (see Option 3 / design D1), so this function
 * returns only the published facts about the version.
 */
async function fetchOne(
  client: ReturnType<typeof createRegistryClient>,
  spec: RegistrySpec,
): Promise<RegistryResult<RegistryMetadata>> {
  // Surface form ('1.2.3', '1.*', '*', 'latest', etc.) is sent verbatim.
  // The server is responsible for accepting/rejecting; we don't widen.
  const versionForUrl = describeVersionSpec(spec.version)

  try {
    const { data, error, response } = await client.GET('/v0/facets/{name}/{version}', {
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

    return {
      ok: true,
      value: {
        name: data.name,
        version: data.version,
        transportHash: data.content_hash,
        contentFingerprint: data.content_integrity,
      },
    }
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}
