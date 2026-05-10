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
import type { RegistryError, RegistryResult } from './types.ts'
import type { WireErrorResponse, WirePublishResponse } from './wire.ts'

export interface PublishArgs {
  /** Canonical facet name (e.g., `'cowsay'` or `'acme/cowsay'`). */
  name: string
  /** Gzipped tarball bytes (as produced by `packFacetSource`). */
  tarball: Uint8Array
  /** Registry API key, sent in the `X-Api-Key` header. */
  apiKey: string
}

/**
 * Four-arm result discriminated union: success / version-exists /
 * structured-error / failure.
 *
 * `version-exists` is split out from the generic failure arms because
 * the publish CLI command renders a hand-tuned fix message
 * ("bump `version` in facet.json and try again") that depends on
 * the server-supplied `docsUrl` from the envelope.
 *
 * `structured-error` carries the full wire envelope alongside the
 * engine's translated `RegistryError`, so CLI call sites can render
 * canonical `whatForCode` / `fixForCode` translations keyed off the
 * wire `code` rather than the server's free-form `error` string.
 *
 * `failure` is for paths where there is no wire envelope to read —
 * thrown errors, network failures, malformed responses, 404 with
 * the resolver's notFoundContext.
 */
export type PublishResult =
  | { kind: 'success'; published: WirePublishResponse }
  | { kind: 'version-exists'; envelope: WireErrorResponse }
  | { kind: 'structured-error'; error: RegistryError; envelope: WireErrorResponse }
  | { kind: 'failure'; error: RegistryError }

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
    const result = await client.POST('/v0/packages/{name}/versions', {
      params: { path: { name: args.name } },
      headers: {
        'X-Api-Key': args.apiKey,
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
      // Structured envelope path: the body parsed as a wire error.
      if (
        typeof runtimeError === 'object' &&
        runtimeError !== null &&
        typeof (runtimeError as { code?: unknown }).code === 'string'
      ) {
        const envelope = runtimeError as WireErrorResponse
        // The 409 VERSION_EXISTS case gets its own arm so the CLI can
        // render the hand-tuned "bump version" fix message.
        if (envelope.code === 'VERSION_EXISTS') {
          return { ok: true, value: { kind: 'version-exists', envelope } }
        }
        return {
          ok: true,
          value: {
            kind: 'structured-error',
            envelope,
            error: translateWireError(envelope, result.response.status),
          },
        }
      }
      // Non-structured body (raw text, HTML error page, etc.).
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
    return {
      ok: true,
      value: { kind: 'success', published: result.data },
    }
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}

// Re-export `encodeFacetName` so callers needing the path-encoded
// name for non-typed-client purposes (e.g., legacy URL composition)
// can grab both at once.
export { encodeFacetName }
