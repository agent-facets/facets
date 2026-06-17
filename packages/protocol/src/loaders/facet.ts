import type { Validated, ValidationError } from '@agent-facets/common'
import { type } from 'arktype'
import { type FacetManifest, FacetManifestSchema } from '../schemas/facet-manifest.ts'
import { mapArkErrors, parseJson } from './validate.ts'

export const FACET_MANIFEST_FILE = 'facet.json'

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
  /** Privacy declaration carried through from the validated manifest when present. */
  private?: boolean
  skills?: Record<
    string,
    {
      description: string
      prompt: string
      adapters?: Record<string, unknown>
    }
  >
  agents?: Record<
    string,
    {
      description: string
      prompt: string
      adapters?: Record<string, unknown>
    }
  >
  commands?: Record<
    string,
    {
      description: string
      prompt: string
      adapters?: Record<string, unknown>
    }
  >
  facets?: FacetManifest['facets']
  servers?: FacetManifest['servers']
}

/**
 * Validates the bytes (or string content) of a facet manifest against the
 * published schema. Pure — no disk I/O. Consumers (engine, the cafe registry,
 * any third-party validator) read bytes from wherever they live and pass them
 * here.
 */
export function validateFacetManifest(bytes: Uint8Array | string): Validated<FacetManifest> {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)

  const jsonResult = parseJson(text)
  if (!jsonResult.ok) {
    return jsonResult
  }

  const validated = FacetManifestSchema(jsonResult.data)
  if (validated instanceof type.errors) {
    return { ok: false, errors: mapArkErrors(validated) }
  }

  return { ok: true, data: validated }
}

/**
 * Resolves prompt content for all skills, agents, and commands using a
 * caller-supplied map of relative path → file content. The map MUST contain
 * an entry for every asset declared in the manifest at its conventional path:
 *
 *   - skill `code-review` → `skills/code-review/SKILL.md`
 *   - agent `reviewer` → `agents/reviewer.md`
 *   - command `run-review` → `commands/run-review.md`
 *
 * Pure — no disk I/O. Consumers build the path-keyed map however they want
 * (engine reads from disk via `Bun.file`; the cafe registry might unpack a
 * tarball into memory).
 *
 * Missing entries are reported as ValidationErrors identifying the asset and
 * its expected path.
 */
export function resolvePromptsFromMap(
  manifest: FacetManifest,
  contentByPath: Record<string, string>,
): Validated<ResolvedFacetManifest> {
  const errors: ValidationError[] = []

  let resolvedSkills: ResolvedFacetManifest['skills'] | undefined
  if (manifest.skills) {
    resolvedSkills = {}
    for (const [name, skill] of Object.entries(manifest.skills)) {
      const path = `skills/${name}/SKILL.md`
      const prompt = contentByPath[path]
      if (typeof prompt === 'string') {
        resolvedSkills[name] = { ...skill, prompt }
      } else {
        errors.push({
          path: `skills.${name}`,
          message: `Prompt content not found for skill "${name}" at ${path}`,
          expected: `entry at "${path}" in content map`,
          actual: 'missing entry',
        })
      }
    }
  }

  let resolvedAgents: ResolvedFacetManifest['agents'] | undefined
  if (manifest.agents) {
    resolvedAgents = {}
    for (const [name, agent] of Object.entries(manifest.agents)) {
      const path = `agents/${name}.md`
      const prompt = contentByPath[path]
      if (typeof prompt === 'string') {
        resolvedAgents[name] = { ...agent, prompt }
      } else {
        errors.push({
          path: `agents.${name}`,
          message: `Prompt content not found for agent "${name}" at ${path}`,
          expected: `entry at "${path}" in content map`,
          actual: 'missing entry',
        })
      }
    }
  }

  let resolvedCommands: ResolvedFacetManifest['commands'] | undefined
  if (manifest.commands) {
    resolvedCommands = {}
    for (const [name, command] of Object.entries(manifest.commands)) {
      const path = `commands/${name}.md`
      const prompt = contentByPath[path]
      if (typeof prompt === 'string') {
        resolvedCommands[name] = { ...command, prompt }
      } else {
        errors.push({
          path: `commands.${name}`,
          message: `Prompt content not found for command "${name}" at ${path}`,
          expected: `entry at "${path}" in content map`,
          actual: 'missing entry',
        })
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
    ...(manifest.private !== undefined && { private: manifest.private }),
    ...(resolvedSkills !== undefined && { skills: resolvedSkills }),
    ...(resolvedAgents !== undefined && { agents: resolvedAgents }),
    ...(resolvedCommands !== undefined && { commands: resolvedCommands }),
    ...(manifest.facets !== undefined && { facets: manifest.facets }),
    ...(manifest.servers !== undefined && { servers: manifest.servers }),
  }

  return { ok: true, data: resolved }
}
