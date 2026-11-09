import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import { describeVersionSpec } from './describe.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from './types.ts'

/**
 * Map a wire metadata body to the internal `RegistryMetadata`, checking
 * it against the request that produced it.
 *
 * `openapi-fetch` performs no response validation — the generated types
 * are a compile-time claim about the schema, not a runtime guarantee
 * about the bytes that arrived. Four things are therefore established
 * here, all failing closed as structured contract violations:
 *
 *   - **Identity.** The body must describe the facet that was asked
 *     for. A response for some other name — a misrouted request, a
 *     mixed-up cache key — would otherwise install one facet's content
 *     under another facet's entry.
 *   - **Exact version.** The resolved version must be an exact
 *     `MAJOR.MINOR.PATCH` this CLI understands, parsed through the same
 *     grammar the manifest uses. A wildcard or tag coming back where a
 *     concrete version belongs means nothing downstream can treat the
 *     result as an immutable published identity.
 *   - **`content_hash`** and **`content_integrity`.** A stale
 *     CDN-cached pre-migration object (camelCase, no
 *     `content_integrity`) deserializes with these `undefined`.
 *     Propagating `undefined` into the integrity chain would silently
 *     disable confirmation, so a missing or empty hash fails closed.
 *     Never fall back to the other hash or skip the check (design D3a
 *     risk note).
 *
 * This does not check that the version *satisfies* the requested spec.
 * Whether `1.*` should have produced `1.8.0` is a question about the
 * caller's intent, and the caller that cares (update discovery) holds
 * the authored specifier and answers it there.
 *
 * Shared by every registry read that resolves a version.
 */
export function metadataFromWire(
  body: {
    name: string
    version: string
    content_hash: string
    content_integrity: string
  },
  requested: RegistrySpec,
): RegistryResult<RegistryMetadata> {
  if (!isNonEmptyString(body.name) || body.name !== requested.name) {
    return contractViolation(
      body,
      `identifies a different facet than the requested "${requested.name}"; ` +
        'refusing to resolve a facet the caller did not ask for',
    )
  }
  if (!isNonEmptyString(body.version) || !isExactVersion(body.version)) {
    return contractViolation(
      body,
      `did not resolve to an exact MAJOR.MINOR.PATCH version (requested ${describeVersionSpec(requested.version)}); ` +
        'refusing to proceed without an immutable published version',
    )
  }
  if (!isNonEmptyString(body.content_hash)) {
    return missingHashField(body, 'content_hash')
  }
  if (!isNonEmptyString(body.content_integrity)) {
    return missingHashField(body, 'content_integrity')
  }
  return {
    ok: true,
    value: {
      name: body.name,
      version: body.version,
      transportHash: body.content_hash,
      contentFingerprint: body.content_integrity,
    },
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * True when a version string is an exact `MAJOR.MINOR.PATCH`.
 *
 * Reuses the manifest version-spec grammar rather than a local regex so
 * there is one definition of what an exact version looks like across
 * manifests, lockfiles, and registry responses.
 */
function isExactVersion(value: string): boolean {
  const parsed = parseVersionSpec(value)
  return parsed.ok && parsed.value.kind === 'exact'
}

function missingHashField(
  body: { name: string; version: string },
  field: 'content_hash' | 'content_integrity',
): RegistryResult<RegistryMetadata> {
  return contractViolation(
    body,
    `is missing a usable ${field} (stale CDN-cached or non-conforming response); refusing to proceed without it`,
  )
}

function contractViolation(body: { name: string; version: string }, detail: string): RegistryResult<RegistryMetadata> {
  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      cause: `registry metadata for ${body.name}@${body.version} ${detail}`,
    },
  }
}
