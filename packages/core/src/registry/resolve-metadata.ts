import { describeVersionSpec } from './describe.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from './types.ts'

/**
 * Resolve registry metadata for a batch of `(name, version)` pairs.
 *
 * Today this function is a stub: it returns `REGISTRY_NOT_AVAILABLE`
 * for every non-empty input and delegates the user toward git/local
 * sources until the real registry ships.
 *
 * Tomorrow's implementation can either fan out concurrent fetches or
 * call a real batch endpoint without touching callers — the batch
 * shape is the durable contract.
 *
 * Empty input returns `{ ok: true, value: [] }` to keep callers that
 * dynamically build batches simple.
 *
 * Pure (no I/O) today; will perform I/O when the real client lands.
 * Always returns; never throws.
 */
export async function resolveRegistryMetadataBatch(
  specs: ReadonlyArray<RegistrySpec>,
): Promise<RegistryResult<ReadonlyArray<RegistryMetadata>>> {
  // TODO(registry): replace with real call to facets.cafe metadata API.
  // The real implementation will: (a) batch all specs into a single
  // request when the API supports it, (b) otherwise fan out concurrent
  // per-spec fetches, (c) return one RegistryMetadata per input spec
  // in input order, or surface NOT_FOUND/NETWORK_ERROR as appropriate.
  if (specs.length === 0) {
    return { ok: true, value: [] }
  }

  const first = specs[0]
  if (first === undefined) {
    return { ok: true, value: [] }
  }
  const sample = `${first.name}@${describeVersionSpec(first.version)}`

  return {
    ok: false,
    error: {
      code: 'REGISTRY_NOT_AVAILABLE',
      what: `registry is not yet available (would query facets.cafe for ${specs.length === 1 ? `"${sample}"` : `${specs.length} facets including "${sample}"`})`,
      fix: 'use a github: shortcut, https URL, ssh URL, or local path until the registry ships',
    },
  }
}
