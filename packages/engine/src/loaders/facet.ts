import { join } from 'node:path'
import type { Validated, ValidationError } from '@agent-facets/common'
import type { FacetManifest } from '@agent-facets/protocol'
import {
  FACET_MANIFEST_FILE,
  type ResolvedFacetManifest,
  resolvePromptsFromMap,
  validateFacetManifest,
} from '@agent-facets/protocol'
import { readFile } from './validate.ts'

// Re-export protocol types so engine consumers can import them from
// `@agent-facets/engine` without reaching into protocol directly.
// The path-based loaders below are the engine's contribution; the
// validators they delegate to live in protocol.
export { FACET_MANIFEST_FILE, type ResolvedFacetManifest }

/**
 * Loads and validates a facet manifest from the specified directory.
 *
 * Reads the facet manifest from disk, then delegates to protocol's
 * `validateFacetManifest` for schema validation. Returns a discriminated
 * result — either the validated manifest or structured errors.
 */
export async function loadManifest(dir: string): Promise<Validated<FacetManifest>> {
  const filePath = join(dir, FACET_MANIFEST_FILE)

  const fileResult = await readFile(filePath)
  if (!fileResult.ok) {
    return fileResult
  }

  return validateFacetManifest(fileResult.content)
}

/**
 * Resolves prompt content for all skills, agents, and commands by reading
 * files at conventional paths relative to the facet root directory.
 *
 * Skills use the Agent Skills directory convention: a skill named "code-review"
 * resolves to `skills/code-review/SKILL.md`. Agents and commands use the flat
 * file convention: `agents/<name>.md` and `commands/<name>.md`.
 *
 * Builds an in-memory `path → content` map from disk, then delegates the
 * resolution logic to protocol's `resolvePromptsFromMap`. File-not-found
 * conditions are translated into ValidationErrors before reaching protocol;
 * protocol itself never touches the filesystem.
 */
export async function resolvePrompts(
  manifest: FacetManifest,
  rootDir: string,
): Promise<Validated<ResolvedFacetManifest>> {
  const errors: ValidationError[] = []
  const contentByPath: Record<string, string> = {}

  const collectAsset = async (assetType: string, name: string): Promise<void> => {
    const relativePath = assetType === 'skills' ? `${assetType}/${name}/SKILL.md` : `${assetType}/${name}.md`
    const filePath = join(rootDir, relativePath)
    const file = Bun.file(filePath)
    const exists = await file.exists()
    if (!exists) {
      errors.push({
        path: `${assetType}.${name}`,
        message: `Prompt file not found: ${relativePath} (resolved to ${filePath})`,
        expected: 'file to exist',
        actual: 'file not found',
      })
      return
    }
    contentByPath[relativePath] = await file.text()
  }

  if (manifest.skills) {
    for (const name of Object.keys(manifest.skills)) {
      await collectAsset('skills', name)
    }
  }
  if (manifest.agents) {
    for (const name of Object.keys(manifest.agents)) {
      await collectAsset('agents', name)
    }
  }
  if (manifest.commands) {
    for (const name of Object.keys(manifest.commands)) {
      await collectAsset('commands', name)
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return resolvePromptsFromMap(manifest, contentByPath)
}
