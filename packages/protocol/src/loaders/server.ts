import type { Validated } from '@agent-facets/common'
import { type } from 'arktype'
import { type ServerManifest, ServerManifestSchema } from '../schemas/server-manifest.ts'
import { mapArkErrors, parseJson } from './validate.ts'

export const SERVER_MANIFEST_FILE = 'server.json'

/**
 * Validates the bytes (or string content) of a server manifest against the
 * published schema. Pure — no disk I/O.
 */
export function validateServerManifest(bytes: Uint8Array | string): Validated<ServerManifest> {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)

  const jsonResult = parseJson(text)
  if (!jsonResult.ok) {
    return jsonResult
  }

  const validated = ServerManifestSchema(jsonResult.data)
  if (validated instanceof type.errors) {
    return { ok: false, errors: mapArkErrors(validated) }
  }

  return { ok: true, data: validated }
}
