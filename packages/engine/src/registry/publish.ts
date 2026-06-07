/**
 * Engine helper for publishing a facet tarball to the registry.
 *
 * Wraps the typed `client.POST('/v0/packages/{name}/versions', ...)`
 * call with the `Uint8Array → string-typed-body → bytes-on-the-wire`
 * plumbing required by the OpenAPI spec's `application/gzip` request
 * shape. Without this helper, every publish call site would duplicate
 * the cast and the `bodySerializer` pass-through.
 *
 * The function deliberately does NOT translate errors to `CliError`
 * — that's CLI-side concern. It returns the typed `RegistryResult`
 * the rest of the engine uses, plus a `version-exists` discriminator
 * arm for the canonical 409 case so call sites can render a hand-tuned
 * "bump version" message without re-checking `error.code`.
 */

import type { Client } from 'openapi-fetch'
import { translateThrownError, translateWireError } from './client.ts'
import type { paths } from './generated/registry-api.ts'
import { encodeFacetName } from './http.ts'
import type { RegistryResult } from './types.ts'
import type { WirePublishResponse, WireQueuedForReviewBody } from './wire.ts'

export interface PublishArgs {
  /** Canonical facet name (e.g., `'cowsay'` or `'acme/cowsay'`). */
  name: string
  /**
   * Verified `.facet` archive bytes — the outer-tar bytes produced by
   * `facet build` (and re-verified by `validateFacetArchive` before
   * upload). The wire `Content-Type` is `application/gzip` per the
   * registry's OpenAPI; the *contents* are the protocol-defined
   * two-layer `.facet` (outer uncompressed tar carrying
   * `build-manifest.json` + the gzipped inner archive).
   */
  tarball: Uint8Array
}

/**
 * Two-arm success discriminated union: published (HTTP 201) or queued
 * for review (HTTP 202).
 *
 * Errors are NOT represented here — they flow through the standard
 * `RegistryResult` `{ ok: false, error }` channel and are rendered
 * verbatim by the CLI (the registry is the single source of truth for
 * error text; see design D4). A duplicate-version `409
 * E_VERSION_EXISTS` is therefore just an ordinary `REGISTRY_REJECTED`
 * error, not a special arm here.
 *
 *   - `published`: the version was published immediately (201).
 *   - `queued`: a first-time publish of a reserved or over-budget
 *     global facet was accepted into the registry's moderation queue
 *     (202). This is a SUCCESS outcome — the CLI renders the
 *     registry's queue-acknowledgement message and exits 0.
 */
export type PublishResult =
  | { kind: 'published'; published: WirePublishResponse }
  | { kind: 'queued'; queued: WireQueuedForReviewBody }

/**
 * Publish a single facet version. Returns a discriminated result;
 * never throws.
 *
 * The wire-side body is `application/gzip` raw bytes. The OpenAPI
 * generator types this as `string` (because `format: binary` on a
 * `string` schema is what spec authors use to model opaque bytes),
 * so the runtime `Uint8Array` needs a cast through `unknown` and
 * a `bodySerializer` that returns the bytes verbatim instead of
 * `JSON.stringify`-ing them. Both are isolated here.
 */
export async function publishFacetVersion(
  client: Client<paths>,
  args: PublishArgs,
): Promise<RegistryResult<PublishResult>> {
  try {
    const result = await client.POST('/v0/facets/{name}/versions', {
      params: { path: { name: args.name } },
      headers: {
        'content-type': 'application/gzip',
      },
      // Cast the Uint8Array through unknown to satisfy the generated
      // `string` body type. The bodySerializer below ensures the
      // runtime body is the raw bytes — without it, openapi-fetch's
      // default serializer would `JSON.stringify` the Uint8Array,
      // corrupting the upload.
      //
      // The `bodySerializer` return type is `any` per openapi-fetch,
      // so we cast back to `unknown as Uint8Array` and let the runtime
      // `fetch` accept it (Bun and undici both accept Uint8Array as
      // a body init).
      body: args.tarball as unknown as string,
      bodySerializer: (body) => body as unknown as Uint8Array,
    })

    const runtimeError = result.error as unknown
    if (runtimeError !== undefined) {
      // Any error — structured envelope or not — is translated by the
      // shared wire-error translator and surfaced through the standard
      // RegistryResult failure channel. The CLI renders the registry's
      // own text verbatim (a 409 E_VERSION_EXISTS included); there is
      // no CLI-side special-casing of any error code.
      return {
        ok: false,
        error: translateWireError(runtimeError as Parameters<typeof translateWireError>[0], result.response.status),
      }
    }

    if (result.data === undefined) {
      return {
        ok: false,
        error: {
          code: 'UNEXPECTED_ERROR',
          cause: `registry returned no body for publish of ${args.name}`,
        },
      }
    }

    // Both 201 (published) and 202 (queued for review) are 2xx, so
    // openapi-fetch surfaces both in `result.data` as a union. The
    // queued body carries the `status: 'QUEUED_FOR_REVIEW'`
    // discriminant; everything else is a normal publish.
    if ('status' in result.data && result.data.status === 'QUEUED_FOR_REVIEW') {
      return { ok: true, value: { kind: 'queued', queued: result.data } }
    }
    return {
      ok: true,
      value: { kind: 'published', published: result.data as WirePublishResponse },
    }
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}

// Re-export `encodeFacetName` so callers needing the path-encoded
// name for non-typed-client purposes (e.g., legacy URL composition)
// can grab both at once.
export { encodeFacetName }
