import type { Client } from 'openapi-fetch'
import { createRegistryClient, type RegistryClientConfig, translateThrownError } from './client.ts'
import type { paths } from './generated/registry-api.ts'
import { resolveRegistryCredential } from './oauth-session.ts'
import type { RegistryResult } from './types.ts'

/** Per-caller middleware tuning; base URL and credential come from the resolved session. */
export type RegistryReadClientOptions = Pick<RegistryClientConfig, 'timeout' | 'retry'>

/**
 * Build the typed client every registry read uses.
 *
 * Authentication is resolved before any resource I/O, and a failed
 * session is returned as `AUTHENTICATION_ERROR` rather than downgraded
 * to an anonymous read: an anonymous fallback would silently hide
 * private facets the user can see and report them as not found.
 */
export async function openRegistryReadClient(
  options: RegistryReadClientOptions = {},
): Promise<RegistryResult<Client<paths>>> {
  try {
    const resolved = await resolveRegistryCredential()
    if (!resolved.ok) {
      return { ok: false, error: { code: 'AUTHENTICATION_ERROR', reason: resolved.error } }
    }
    const cred = resolved.value
    return {
      ok: true,
      value: createRegistryClient(
        cred.source === 'oauth'
          ? { ...options, baseUrl: cred.registryOrigin, credential: cred.token, credentialPolicy: 'oauth' }
          : { ...options, credential: cred.source === 'absent' ? undefined : cred.token },
      ),
    }
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}
