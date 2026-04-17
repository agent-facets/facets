import { join } from 'node:path'
import type { Validated } from '@agent-facets/common'
import { type } from 'arktype'
import { type ServerManifest, ServerManifestSchema } from '../schemas/server-manifest.ts'
import { mapArkErrors, parseJson, readFile } from './validate.ts'

const SERVER_MANIFEST_FILE = 'server.json'

/**
 * Loads and validates a server manifest from the specified directory.
 *
 * Reads the server manifest, parses JSON, validates against the schema, and returns
 * a discriminated result — either the validated manifest or structured errors.
 */
export async function loadServerManifest(dir: string): Promise<Validated<ServerManifest>> {
  const filePath = join(dir, SERVER_MANIFEST_FILE)

  // Phase 0: Read the file
  const fileResult = await readFile(filePath)
  if (!fileResult.ok) {
    return fileResult
  }

  // Phase 1: Parse JSON
  const jsonResult = parseJson(fileResult.content)
  if (!jsonResult.ok) {
    return jsonResult
  }

  // Phase 2: Schema validation
  const validated = ServerManifestSchema(jsonResult.data)
  if (validated instanceof type.errors) {
    return { ok: false, errors: mapArkErrors(validated) }
  }

  return { ok: true, data: validated }
}
