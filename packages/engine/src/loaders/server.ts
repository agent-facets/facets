import { join } from 'node:path'
import type { Validated } from '@agent-facets/common'
import { type ServerManifest, validateServerManifest } from '@agent-facets/protocol'
import { readFile } from './validate.ts'

const SERVER_MANIFEST_FILE = 'server.json'

/**
 * Loads and validates a server manifest from the specified directory.
 *
 * Reads the server manifest from disk, then delegates to protocol's
 * `validateServerManifest` for schema validation. Returns a discriminated
 * result — either the validated manifest or structured errors.
 */
export async function loadServerManifest(dir: string): Promise<Validated<ServerManifest>> {
  const filePath = join(dir, SERVER_MANIFEST_FILE)

  const fileResult = await readFile(filePath)
  if (!fileResult.ok) {
    return fileResult
  }

  return validateServerManifest(fileResult.content)
}
