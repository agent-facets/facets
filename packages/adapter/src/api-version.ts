/**
 * Canonical adapter API contract identifiers.
 *
 * The adapter API version is a discrete contract token compared for exact
 * equality — it is NOT a semantic-version range and is independent of the
 * CLI version, this SDK package's version, and adapter package versions.
 *
 * This module is the single source of truth for both the API value and the
 * package-metadata field name. Engine compatibility checks and first-party
 * release tooling import these constants instead of repeating the literals.
 */

/**
 * The adapter API contract identifier this SDK stamps into every adapter
 * returned by `defineAdapter()`. Identifies the current tagged
 * request/result adapter method contract.
 *
 * This supersedes the earlier positional method contract, which was
 * identified by `0.0`. A CLI that supports only `0.1` classifies a `0.0`
 * adapter as well-formed but unsupported and fails closed — the exact-token
 * compatibility machinery cannot inspect method signatures, so the contract
 * change is signalled by this identifier, never inferred.
 */
export const ADAPTER_API_VERSION = '0.1' as const

/**
 * The top-level `package.json` field where a published npm adapter release
 * declares its adapter API version, so compatibility can be determined
 * before downloading the bundle.
 */
export const ADAPTER_API_VERSION_PACKAGE_FIELD = 'facetAdapterApiVersion' as const

/** The adapter API identifier type produced by this SDK. */
export type AdapterApiVersion = typeof ADAPTER_API_VERSION
