import { translateThrownError, translateWireError } from './client.ts'
import { facetNameToRoute } from './http.ts'
import { openRegistryReadClient, type RegistryReadClientOptions } from './read-client.ts'
import type { RegistryResult } from './types.ts'
import type { WireContentsResponse } from './wire.ts'

export type RegistryContentsFile =
  | { kind: 'text'; path: string; content: string }
  | { kind: 'binary'; path: string; sizeBytes: number }

export interface RegistryVersionContents {
  name: string
  version: string
  contentFingerprint: string
  /** Keyed by facet-root-relative path. The manifest is never included. */
  files: ReadonlyMap<string, RegistryContentsFile>
}

/**
 * Read the verified files of one exact version.
 *
 * Takes an exact version only: a caller that starts from `latest`
 * resolves it through version details first, so the files it shows
 * always belong to the version it named.
 */
export async function fetchRegistryVersionContents(
  name: string,
  exactVersion: string,
  options: RegistryReadClientOptions = {},
): Promise<RegistryResult<RegistryVersionContents>> {
  const opened = await openRegistryReadClient(options)
  if (!opened.ok) return opened
  const client = opened.value

  const route = facetNameToRoute(name)
  try {
    const { data, error, response } =
      route.kind === 'scoped'
        ? await client.GET('/v0/facets/{scope}/{name}/{version}/contents', {
            params: { path: { scope: route.scope, name: route.name, version: exactVersion } },
          })
        : await client.GET('/v0/facets/{name}/{version}/contents', {
            params: { path: { name: route.name, version: exactVersion } },
          })
    if (error !== undefined) {
      return { ok: false, error: translateWireError(error, response.status, { name, spec: exactVersion }) }
    }
    return contentsFromWire(data, name, exactVersion)
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}

/**
 * Map a contents body, checking it describes the requested version.
 *
 * `openapi-fetch` does not validate responses, so a misrouted or stale
 * body for another facet or version would otherwise be shown as this
 * one's files.
 *
 * Exported for unit testing.
 */
export function contentsFromWire(
  body: WireContentsResponse,
  name: string,
  exactVersion: string,
): RegistryResult<RegistryVersionContents> {
  if (body.name !== name || body.version !== exactVersion) {
    return violation(
      `registry contents for ${name}@${exactVersion} described ${String(body.name)}@${String(body.version)}; refusing to show another version's files`,
    )
  }
  if (typeof body.content_integrity !== 'string' || body.content_integrity.length === 0) {
    return violation(`registry contents for ${name}@${exactVersion} are missing content_integrity`)
  }
  if (!Array.isArray(body.files)) {
    return violation(`registry contents for ${name}@${exactVersion} have no file list`)
  }

  const files = new Map<string, RegistryContentsFile>()
  for (const file of body.files) {
    if (typeof file.path !== 'string' || file.path.length === 0 || files.has(file.path)) {
      return violation(`registry contents for ${name}@${exactVersion} carry a missing or duplicate file path`)
    }
    if (file.kind === 'text' && typeof file.content === 'string') {
      files.set(file.path, { kind: 'text', path: file.path, content: file.content })
    } else if (file.kind === 'binary' && typeof file.size_bytes === 'number') {
      files.set(file.path, { kind: 'binary', path: file.path, sizeBytes: file.size_bytes })
    } else {
      return violation(`registry contents for ${name}@${exactVersion} carry a malformed entry for ${file.path}`)
    }
  }

  return { ok: true, value: { name, version: exactVersion, contentFingerprint: body.content_integrity, files } }
}

function violation(cause: string): { ok: false; error: { code: 'UNEXPECTED_ERROR'; cause: string } } {
  return { ok: false, error: { code: 'UNEXPECTED_ERROR', cause } }
}
