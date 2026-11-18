import { createRegistryClient, translateThrownError, translateWireError } from './client.ts'
import { resolveRegistryCredential } from './oauth-session.ts'
import type { RegistryError } from './types.ts'
import type { WirePackageListItem } from './wire.ts'

export type SearchRegistryResult =
  | { ok: true; facets: WirePackageListItem[] }
  | { ok: false; error: RegistryError }
  | { ok: false; error: { code: 'INVALID_SEARCH_RESPONSE' } }

/** Search the first registry page without coupling the request to a terminal view. */
export async function searchRegistry(term?: string): Promise<SearchRegistryResult> {
  const resolved = await resolveRegistryCredential()
  if (!resolved.ok) return { ok: false, error: { code: 'AUTHENTICATION_ERROR', reason: resolved.error } }
  const credential = resolved.value
  const client = createRegistryClient(
    credential.source === 'oauth'
      ? { baseUrl: credential.registryOrigin, credential: credential.token, credentialPolicy: 'oauth' }
      : { credential: credential.source === 'absent' ? undefined : credential.token },
  )
  try {
    const { data, error, response } = await client.GET('/v0/facets', {
      params: term === undefined ? {} : { query: { q: term } },
    })
    if (error !== undefined) {
      return {
        ok: false,
        error: translateWireError(error as Parameters<typeof translateWireError>[0], response.status),
      }
    }
    if (data === undefined || !Array.isArray(data.facets)) {
      return { ok: false, error: { code: 'INVALID_SEARCH_RESPONSE' } }
    }
    return { ok: true, facets: data.facets }
  } catch (error) {
    return { ok: false, error: translateThrownError(error) }
  }
}
