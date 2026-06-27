import type { VersionSpec } from '@agent-facets/protocol'
import { resolveRegistryMetadataBatch } from '../../registry/index.ts'
import type { RegistryError, RegistryMetadata } from '../../registry/types.ts'
import type { MaterializeVersionResult } from '../materialize-version/index.ts'
import type { OnLog, RunInstallFailure, StageEvent } from '../types.ts'

/**
 * Fetch metadata for a single spec, normalizing the batch surface to a
 * one-value result. An empty batch response (registry returned nothing
 * for the requested facet) is reported as a network error.
 */
export async function fetchMeta(
  name: string,
  version: VersionSpec,
  onStage: (event: StageEvent) => void,
  onLog: OnLog,
): Promise<{ ok: true; value: RegistryMetadata } | { ok: false; error: RegistryError }> {
  onLog(() => `[verbose]   fetching registry metadata for ${name}`)
  onStage({ kind: 'facet-stage', facet: name, stage: 'fetch' })
  const metaResult = await resolveRegistryMetadataBatch([{ name, version }])
  if (!metaResult.ok) return metaResult
  const meta = metaResult.value[0]
  if (meta === undefined) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        cause: 'registry returned no metadata for the requested facet',
        attempts: 1,
      },
    }
  }
  return { ok: true, value: meta }
}

/**
 * Map a materialization-chain failure to the orchestrator-level
 * failure. The `cache-tampered` arm never reaches here — the caller
 * retries it as a miss, and the miss path cannot produce it.
 */
export function chainFailureToRunInstall(
  facet: string,
  result: Extract<MaterializeVersionResult, { ok: false }>,
): RunInstallFailure {
  switch (result.code) {
    case 'lockfile-mismatch':
      // Audited cache content contradicts the lockfile: a coordinated
      // bytes+sidecar rewrite, or a registry that broke immutability.
      // Hard failure — deliberately not self-healing.
      return {
        code: 'CACHE_INTEGRITY_MISMATCH',
        facet,
        slotPath: result.slotPath,
        cachedIntegrity: result.observed,
        lockedIntegrity: result.expected,
      }
    case 'confirmation-mismatch':
      // Check A semantics: audited content vs the registry's published
      // fingerprint.
      return {
        code: 'INTEGRITY_FAILURE',
        failure: { kind: 'facet', facet, check: 'A', expected: result.expected, observed: result.observed },
      }
    case 'download-failed':
      return { code: 'REGISTRY_ERROR', facet, error: result.error }
    case 'integrity-failed':
      return { code: 'INTEGRITY_FAILURE', failure: result.failure }
    case 'cache-tampered':
      // Handled by the caller's single retry; the retry input is a miss
      // variant, which structurally cannot produce this code.
      throw new Error('unreachable: cache-tampered must be retried as a miss before mapping')
  }
}
