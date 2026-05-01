import type { VersionSpec } from '../sources/facet/types.ts'

/**
 * Metadata returned by the registry for a single resolved facet.
 *
 *   - `name`: the facet's name as published.
 *   - `version`: the exact resolved version (e.g., `"1.2.3"`). When the
 *     caller passed a wildcard or `latest`, this is the version the
 *     registry chose.
 *   - `expectedIntegrity`: the integrity hash the registry claims this
 *     `(name, version)` should produce. Format `sha256:<hex>`. Fed
 *     into the three-check protocol as the metadata-API anchor.
 *   - `tarballUrl`: the URL from which the `.facet` archive can be
 *     downloaded. Passed verbatim to `downloadAndExtractFacet`.
 */
export interface RegistryMetadata {
  name: string
  version: string
  expectedIntegrity: string
  tarballUrl: string
}

/**
 * Input shape for batch metadata resolution: a name plus the version
 * spec the user wrote (which may be wildcard/latest/exact).
 */
export interface RegistrySpec {
  name: string
  version: VersionSpec
}

/**
 * Discriminated registry-error type.
 *
 *   - `REGISTRY_NOT_AVAILABLE`: the registry client is currently a
 *     stub. Returned for every call until a real client ships.
 *   - `NOT_FOUND`: the requested name/version did not match any
 *     published facet. (Reserved for the real client.)
 *   - `NETWORK_ERROR`: transport failed. (Reserved for the real client.)
 */
export type RegistryError =
  | { code: 'REGISTRY_NOT_AVAILABLE'; what: string; fix: string }
  | { code: 'NOT_FOUND'; name: string; spec: string }
  | { code: 'NETWORK_ERROR'; cause: string }

/**
 * Result type for registry operations. Discriminated by `ok`.
 *
 * The registry client never throws. Callers branch on `result.ok` and
 * either consume `result.value` or surface `result.error` through the
 * normal display path.
 */
export type RegistryResult<T> = { ok: true; value: T } | { ok: false; error: RegistryError }
