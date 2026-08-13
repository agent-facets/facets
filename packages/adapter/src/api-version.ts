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
 * returned by `defineAdapter()`. Identifies the read-only *planning* contract:
 * an adapter computes exact per-file state transitions and returns them, and
 * the caller performs every write.
 *
 * The exact-token compatibility machinery cannot inspect method signatures or
 * probe for fields, so every contract change is signalled by this identifier
 * and never inferred.
 *
 * Superseded tokens deliberately have no constants here. `0.0` named the
 * positional method contract; `0.1` and `0.2` named contracts in which the
 * adapter itself mutated the filesystem and was responsible for undoing its
 * own work. No caller can offer those the guarantees this one makes — exact
 * byte restoration, concurrency preflight, batch atomicity — so naming them
 * would only invite someone to add them back to a support set.
 */
export const ADAPTER_API_VERSION = '0.3' as const

/**
 * The top-level `package.json` field where a published npm adapter release
 * declares its adapter API version, so compatibility can be determined
 * before downloading the bundle.
 */
export const ADAPTER_API_VERSION_PACKAGE_FIELD = 'facetAdapterApiVersion' as const

/** The adapter API identifier type produced by this SDK. */
export type AdapterApiVersion = typeof ADAPTER_API_VERSION
