import { join } from 'node:path'
import type { Validated, ValidationError } from '@agent-facets/common'
import { type } from 'arktype'
import { type FacetManifest, FacetManifestSchema } from '../schemas/facet-manifest.ts'
import { mapArkErrors, parseJson, readFile } from './validate.ts'

export const FACET_MANIFEST_FILE = 'facet.json'

/**
 * Loads and validates a facet manifest from the specified directory.
 *
 * Reads the facet manifest, parses JSON, validates against the schema, and checks
 * business-rule constraints. Returns a discriminated result — either the
 * validated manifest or structured errors.
 */
export async function loadManifest(dir: string): Promise<Validated<FacetManifest>> {
  const filePath = join(dir, FACET_MANIFEST_FILE)

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
  const validated = FacetManifestSchema(jsonResult.data)
  if (validated instanceof type.errors) {
    return { ok: false, errors: mapArkErrors(validated) }
  }

  return { ok: true, data: validated }
}

/**
 * A manifest with all prompts resolved to their string content.
 * File paths are derived from convention: skills use `skills/<name>/SKILL.md`,
 * agents use `agents/<name>.md`, commands use `commands/<name>.md`.
 */
export interface ResolvedFacetManifest {
  name: string
  version: string
  description?: string
  author?: string
  skills?: Record<
    string,
    {
      description: string
      prompt: string
      harnesses?: Record<string, unknown>
    }
  >
  agents?: Record<
    string,
    {
      description: string
      prompt: string
      harnesses?: Record<string, unknown>
    }
  >
  commands?: Record<
    string,
    {
      description: string
      prompt: string
    }
  >
  facets?: FacetManifest['facets']
  servers?: FacetManifest['servers']
}

/**
 * Resolves prompt content for all skills, agents, and commands by reading
 * files at conventional paths relative to the facet root directory.
 *
 * Skills use the Agent Skills directory convention: a skill named "code-review"
 * resolves to `skills/code-review/SKILL.md`. Agents and commands use the flat
 * file convention: `agents/<name>.md` and `commands/<name>.md`.
 *
 * This also serves as file existence verification for all three asset types —
 * if an expected file doesn't exist, resolution fails with an error identifying
 * the asset and the expected file path.
 *
 * Returns a new manifest with all prompts resolved to strings, or an error
 * result identifying which prompt failed and why.
 */
export async function resolvePrompts(
  manifest: FacetManifest,
  rootDir: string,
): Promise<Validated<ResolvedFacetManifest>> {
  const errors: ValidationError[] = []

  // Resolve skill prompts from skills/<name>/SKILL.md
  let resolvedSkills: ResolvedFacetManifest['skills'] | undefined
  if (manifest.skills) {
    resolvedSkills = {}
    for (const [name, skill] of Object.entries(manifest.skills)) {
      const resolvedPrompt = await resolveAssetPrompt('skills', name, rootDir)
      if (typeof resolvedPrompt === 'string') {
        resolvedSkills[name] = { ...skill, prompt: resolvedPrompt }
      } else {
        errors.push(resolvedPrompt)
      }
    }
  }

  // Resolve agent prompts from agents/<name>.md
  let resolvedAgents: ResolvedFacetManifest['agents'] | undefined
  if (manifest.agents) {
    resolvedAgents = {}
    for (const [name, agent] of Object.entries(manifest.agents)) {
      const resolvedPrompt = await resolveAssetPrompt('agents', name, rootDir)
      if (typeof resolvedPrompt === 'string') {
        resolvedAgents[name] = { ...agent, prompt: resolvedPrompt }
      } else {
        errors.push(resolvedPrompt)
      }
    }
  }

  // Resolve command prompts from commands/<name>.md
  let resolvedCommands: ResolvedFacetManifest['commands'] | undefined
  if (manifest.commands) {
    resolvedCommands = {}
    for (const [name, command] of Object.entries(manifest.commands)) {
      const resolvedPrompt = await resolveAssetPrompt('commands', name, rootDir)
      if (typeof resolvedPrompt === 'string') {
        resolvedCommands[name] = { ...command, prompt: resolvedPrompt }
      } else {
        errors.push(resolvedPrompt)
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const resolved: ResolvedFacetManifest = {
    name: manifest.name,
    version: manifest.version,
    ...(manifest.description !== undefined && { description: manifest.description }),
    ...(manifest.author !== undefined && { author: manifest.author }),
    ...(resolvedSkills !== undefined && { skills: resolvedSkills }),
    ...(resolvedAgents !== undefined && { agents: resolvedAgents }),
    ...(resolvedCommands !== undefined && { commands: resolvedCommands }),
    ...(manifest.facets !== undefined && { facets: manifest.facets }),
    ...(manifest.servers !== undefined && { servers: manifest.servers }),
  }

  return { ok: true, data: resolved }
}

/**
 * Resolves prompt content for a single asset by reading the file at its
 * conventional path. Skills use `skills/<name>/SKILL.md` (Agent Skills
 * directory convention). Agents and commands use `<type>/<name>.md`.
 * Returns the file content as a string, or a ValidationError if the file doesn't exist.
 */
async function resolveAssetPrompt(assetType: string, name: string, rootDir: string): Promise<string | ValidationError> {
  const relativePath = assetType === 'skills' ? `${assetType}/${name}/SKILL.md` : `${assetType}/${name}.md`
  const filePath = join(rootDir, relativePath)
  const file = Bun.file(filePath)
  const exists = await file.exists()

  if (!exists) {
    return {
      path: `${assetType}.${name}`,
      message: `Prompt file not found: ${relativePath} (resolved to ${filePath})`,
      expected: 'file to exist',
      actual: 'file not found',
    }
  }

  return file.text()
}
