// Subpath import: `api-version` is a dependency-free module, so engine's
// runtime graph stays free of the full SDK (yaml, asset-fs, common). This
// also avoids a bun:test-runner cache collision between runtime-loaded SDK
// sources and in-process `Bun.build` runs over the same files.
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'

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
 * The exact adapter APIs this CLI supports — the compatibility window.
 *
 * This is the CLI's sole concrete declaration of what it accepts. Every
 * check (verification, loading, listing, npm selection, package-versus-runtime
 * agreement) and every diagnostic derives from it; no other module, prose
 * string, or test restates the literals.
 *
 * The value comes from the SDK so the token's literal appears in exactly one
 * place. Membership is unordered and exact: a token is accepted or it is not,
 * and numeric proximity to an accepted one confers nothing.
 *
 * The set is currently a single token because the earlier contracts are not
 * merely older — under them the adapter performed its own writes and owned its
 * own rollback, so no caller can offer them the guarantees this CLI now makes
 * about exact restoration and concurrency. Accepting one would mean silently
 * dropping those guarantees for the assets it materialized.
 */
export const SUPPORTED_ADAPTER_APIS: readonly string[] = [ADAPTER_API_VERSION]

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
  | { kind: 'supported'; api: string }
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
  if (!SUPPORTED_ADAPTER_APIS.includes(declared)) {
    return { kind: 'unsupported', api: declared }
  }
  return { kind: 'supported', api: declared }
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
