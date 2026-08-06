// Subpath import: `api-version` is a dependency-free module, so engine's
// runtime graph stays free of the full SDK (yaml, asset-fs, common). This
// also avoids a bun:test-runner cache collision between runtime-loaded SDK
// sources and in-process `Bun.build` runs over the same files.
import { ADAPTER_API_VERSION, ADAPTER_API_VERSION_ASSETS_ONLY } from '@agent-facets/adapter/api-version'

/**
 * Pure adapter-API compatibility primitives.
 *
 * Adapter API versions are discrete contract identifiers compared for
 * exact equality — never semantic-version ranges. This module owns the
 * CLI's support set, the canonical syntax rule, and the shared failure
 * union consumed by npm selection, candidate verification, installed
 * loading, and build/install preflights. No I/O, no user-facing prose —
 * CLI renderers map these values to messages.
 */

/**
 * The runtime object shape a supported adapter API requires.
 *
 * Not a version comparison: the token is opaque, and this says what the CLI
 * must find on the imported object once it knows which contract that token
 * names.
 */
export type AdapterContractShape = 'assets-only' | 'assets-and-mcp'

/**
 * Every adapter API this CLI supports, mapped to the runtime shape it
 * promises.
 *
 * Support and shape-verifiability are the same fact, so they are one table
 * rather than a set plus a parallel lookup that could disagree. A token this
 * CLI accepts but has no shape check for is not representable.
 */
const ADAPTER_API_CONTRACTS: Readonly<Record<string, AdapterContractShape>> = {
  [ADAPTER_API_VERSION_ASSETS_ONLY]: 'assets-only',
  [ADAPTER_API_VERSION]: 'assets-and-mcp',
}

/**
 * The exact adapter APIs this CLI supports — the compatibility window.
 *
 * This is the CLI's sole concrete declaration of what it accepts. Every
 * check (verification, loading, listing, npm selection, package-versus-runtime
 * agreement) and every diagnostic derives from it; no other module, prose
 * string, or test restates the literals.
 *
 * The values come from the SDK so each token's literal appears in exactly one
 * place. Membership is unordered: the array order is presentation only, and
 * nothing may read it as precedence. Widening the set adds an acceptable
 * token; it never changes what an existing token means, and it never weakens
 * an exact-token equality check.
 */
export const SUPPORTED_ADAPTER_APIS: readonly string[] = Object.keys(ADAPTER_API_CONTRACTS)

/**
 * Canonical adapter API syntax: `MAJOR.MINOR` in decimal with no sign,
 * suffix, build metadata, patch component, or leading zeroes other than
 * the number zero itself.
 */
const ADAPTER_API_SYNTAX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** True iff `value` is a syntactically valid adapter API identifier. */
export function isWellFormedAdapterApi(value: string): boolean {
  return ADAPTER_API_SYNTAX.test(value)
}

/**
 * Classification of a declared adapter API value — from a runtime
 * `apiVersion` export or a package-metadata field. `undefined` and
 * `null` classify as missing; any non-string or syntactically invalid
 * string classifies as malformed.
 */
export type ApiDeclarationClassification =
  | { kind: 'supported'; api: string; contract: AdapterContractShape }
  | { kind: 'unsupported'; api: string }
  | { kind: 'malformed'; found: string }
  | { kind: 'missing' }

/**
 * Classify a declared adapter API value against the CLI support set.
 * Pure; shared by npm release filtering and runtime verification so both
 * sides apply identical rules.
 */
export function classifyApiDeclaration(declared: unknown): ApiDeclarationClassification {
  if (declared === undefined || declared === null) {
    return { kind: 'missing' }
  }
  if (typeof declared !== 'string') {
    // String() throws for null-prototype objects and throwing
    // Symbol.toPrimitive implementations; the contract says any
    // non-string classifies as malformed, so coerce defensively.
    let found: string
    try {
      found = String(declared)
    } catch {
      found = '<uncoercible>'
    }
    return { kind: 'malformed', found }
  }
  if (!isWellFormedAdapterApi(declared)) {
    return { kind: 'malformed', found: declared }
  }
  // Membership *is* having a known contract shape — one lookup, so a token
  // cannot be accepted without the CLI knowing what to verify on it.
  const contract = ADAPTER_API_CONTRACTS[declared]
  if (contract === undefined) {
    return { kind: 'unsupported', api: declared }
  }
  return { kind: 'supported', api: declared, contract }
}

/**
 * The shared compatibility failure union.
 *
 * `adapter` is the best-known identity at the failure site: the runtime
 * adapter name when the bundle exposes one, otherwise the npm package
 * name or bundle path. Every variant carries the CLI support set so
 * renderers never reach back into this module for it.
 */
export type AdapterCompatibilityFailure =
  | { kind: 'api-missing'; adapter: string; supported: readonly string[] }
  | { kind: 'api-malformed'; adapter: string; found: string; supported: readonly string[] }
  | { kind: 'api-unsupported'; adapter: string; found: string; supported: readonly string[] }
  | {
      kind: 'api-metadata-mismatch'
      adapter: string
      packageDeclared: string
      runtimeDeclared: string
      supported: readonly string[]
    }

/** A classification that is not `supported` — the arms that map to failures. */
export type IncompatibleClassification = Exclude<ApiDeclarationClassification, { kind: 'supported' }>

/**
 * Map an already-computed incompatible classification to the
 * compatibility failure for `adapter`. The single source of the
 * classification-to-failure mapping — shared by `compatibilityFailureFor`
 * and runtime verification so the failure shapes exist once.
 */
export function failureForClassification(
  adapter: string,
  classified: IncompatibleClassification,
): AdapterCompatibilityFailure {
  switch (classified.kind) {
    case 'missing':
      return { kind: 'api-missing', adapter, supported: SUPPORTED_ADAPTER_APIS }
    case 'malformed':
      return { kind: 'api-malformed', adapter, found: classified.found, supported: SUPPORTED_ADAPTER_APIS }
    case 'unsupported':
      return { kind: 'api-unsupported', adapter, found: classified.api, supported: SUPPORTED_ADAPTER_APIS }
  }
}

/**
 * Classify a declared value and, when it is not supported, map it to
 * the compatibility failure for `adapter`. Returns null for supported
 * declarations. Shared by the build and install defense-in-depth
 * preflights so classification-to-failure mapping exists once.
 */
export function compatibilityFailureFor(adapter: string, declared: unknown): AdapterCompatibilityFailure | null {
  const classified = classifyApiDeclaration(declared)
  if (classified.kind === 'supported') {
    return null
  }
  return failureForClassification(adapter, classified)
}
