import { createRegistryClient, translateThrownError, translateWireError } from './client.ts'
import type { RegistryResult } from './types.ts'
import type { WireAuthMeResponse } from './wire.ts'

/**
 * Fetch the authenticated user's profile from `GET /v0/auth/me` using
 * the supplied bearer credential.
 *
 * Used in two places:
 *
 *   - `facet login` verifies a freshly-pasted token by calling this
 *     with that token BEFORE persisting it — a rejected token surfaces
 *     the registry's own error and is never written to disk.
 *   - `facet whoami` calls this with the resolved credential to read
 *     back the signed-in identity.
 *
 * The credential is passed explicitly (rather than resolved internally)
 * because `login`'s call must authenticate with the just-pasted token,
 * not whatever the resolver would currently return. Never throws —
 * returns a discriminated `RegistryResult`.
 */
export async function fetchAuthMe(credential: string): Promise<RegistryResult<WireAuthMeResponse>> {
  const client = createRegistryClient({ credential })
  try {
    const { data, error, response } = await client.GET('/v0/auth/me', {})
    if (error !== undefined) {
      return {
        ok: false,
        error: translateWireError(error as Parameters<typeof translateWireError>[0], response.status),
      }
    }
    if (data === undefined) {
      return {
        ok: false,
        error: { code: 'UNEXPECTED_ERROR', cause: 'registry returned no profile body for /v0/auth/me' },
      }
    }
    return { ok: true, value: data }
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}
