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
 * returned by `defineAdapter()`. Identifies the tagged request/result asset
 * method contract **plus** the required MCP server capability.
 *
 * The exact-token compatibility machinery cannot inspect method signatures or
 * probe for fields, so every contract change is signalled by this identifier
 * and never inferred. That is why adding `mcpServers` required a new token
 * rather than a runtime feature check.
 */
export const ADAPTER_API_VERSION = '0.2' as const

/**
 * The superseded asset-only contract: the same tagged request/result asset
 * methods, with no MCP server capability.
 *
 * This SDK no longer stamps it — `defineAdapter()` always produces
 * {@link ADAPTER_API_VERSION}. It exists as a named constant because adapters
 * published against it remain loadable during the compatibility window, and
 * the literal `'0.1'` should appear in exactly one place across the monorepo.
 *
 * Older still is the positional method contract, identified by `0.0`. It has
 * no constant here: nothing supports it, and naming it would invite someone to
 * add it to a support set.
 */
export const ADAPTER_API_VERSION_ASSETS_ONLY = '0.1' as const

/**
 * The top-level `package.json` field where a published npm adapter release
 * declares its adapter API version, so compatibility can be determined
 * before downloading the bundle.
 */
export const ADAPTER_API_VERSION_PACKAGE_FIELD = 'facetAdapterApiVersion' as const

/** The adapter API identifier type produced by this SDK. */
export type AdapterApiVersion = typeof ADAPTER_API_VERSION

/** The superseded asset-only adapter API identifier type. */
export type AdapterApiVersionAssetsOnly = typeof ADAPTER_API_VERSION_ASSETS_ONLY
