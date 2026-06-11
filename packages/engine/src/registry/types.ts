import type { VersionSpec } from '@agent-facets/protocol'

/**
 * Metadata returned by the registry for a single resolved facet.
 *
 *   - `name`: the facet's name as published.
 *   - `version`: the exact resolved version (e.g., `"1.2.3"`). When the
 *     caller passed a wildcard or `latest`, this is the version the
 *     registry chose.
 *   - `transportHash`: sha256 of the uploaded `.facet` archive (the
 *     uncompressed outer tar containing `build-manifest.json` and the
 *     gzipped inner `archive.tar.gz`; the wire `Content-Type` is
 *     `application/gzip` but these bytes are the outer tar itself).
 *     Used only by `download.ts` for the raw-bytes transport check
 *     after downloading.
 *   - `contentFingerprint`: sha256 of the canonical archive (the inner
 *     uncompressed tar). This is the domain the cache sidecar, the
 *     lockfile, and `build-manifest.json` all record. Fed to the
 *     three-check protocol as `expectedIntegrity` and used for
 *     integrity confirmation when creating a lockfile entry.
 *
 * Deliberately carries no archive URL. How the archive bytes are
 * obtained (today: a typed request to the archive endpoint that
 * returns a 302 redirect to a presigned S3 URL) is an implementation
 * detail confined to `downloadAndExtractFacet`, which resolves it
 * just-in-time from `name` + `version`. Keeping the URL out of this
 * data model means a future change to the archive transport (e.g. the
 * registry serving bytes directly, or changing the redirect target)
 * is localized to the download path and does not ripple through this
 * type or its callers.
 */
export interface RegistryMetadata {
  name: string
  version: string
  transportHash: string
  contentFingerprint: string
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
 *   - `REGISTRY_REJECTED`: the registry returned a 4xx/5xx with a
 *     well-formed structured error envelope. Carries the envelope's
 *     `wireCode`, `error`, `fix`, and `docsUrl` **verbatim** — the CLI
 *     renders the registry's own text without any local code-to-message
 *     map. The registry is the single source of truth for what an error
 *     means and how to fix it.
 *   - `UNPARSEABLE_RESPONSE`: the registry replied with something that
 *     is not a valid structured envelope (a CloudFront HTML 502, an
 *     empty 503, raw text). There is no server text to render, so the
 *     CLI authors a plain "could not process the response" message and
 *     directs the user nowhere. `status` carries the HTTP status for
 *     context.
 *   - `NOT_FOUND`: the requested name/version did not match any
 *     published facet (HTTP 404).
 *   - `NETWORK_ERROR`: transport failed (DNS, TCP, abort, timeout)
 *     after exhausting the configured retry budget. `attempts`
 *     records how many tries were made so the user-facing message
 *     can include retry history (e.g., "after 3 attempts").
 *   - `UNEXPECTED_ERROR`: a thrown error that wasn't a recognized
 *     network failure shape. Surfaces honestly rather than being
 *     silently relabeled as a network error (per design D11).
 */
export type RegistryError =
  | { code: 'REGISTRY_REJECTED'; wireCode: string; error: string; fix: string; docsUrl: string }
  | { code: 'UNPARSEABLE_RESPONSE'; status: number }
  | { code: 'NOT_FOUND'; name: string; spec: string }
  | { code: 'NETWORK_ERROR'; cause: string; attempts: number }
  | { code: 'UNEXPECTED_ERROR'; cause: string }

/**
 * Result type for registry operations. Discriminated by `ok`.
 *
 * The registry client never throws. Callers branch on `result.ok` and
 * either consume `result.value` or surface `result.error` through the
 * normal display path.
 */
export type RegistryResult<T> = { ok: true; value: T } | { ok: false; error: RegistryError }
