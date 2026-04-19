import { type } from 'arktype'

// --- Sub-schemas ---

/** Skill descriptor — description is required, prompt resolved from skills/<name>/SKILL.md */
const SkillDescriptor = type({
  description: 'string',
  'adapters?': type.Record('string', 'unknown'),
})

/** Agent descriptor — description is required, prompt resolved from agents/<name>.md */
const AgentDescriptor = type({
  description: 'string',
  'adapters?': type.Record('string', 'unknown'),
})

/** Command descriptor — description is required, prompt resolved from commands/<name>.md */
const CommandDescriptor = type({
  description: 'string',
})

/** Selective facets entry — cherry-pick specific assets from another facet */
const SelectiveFacetsEntry = type({
  name: 'string',
  version: 'string',
  'skills?': 'string[]',
  'agents?': 'string[]',
  'commands?': 'string[]',
})

/** Facets entry: compact string ("name@version") or selective object */
const FacetsEntry = type('string').or(SelectiveFacetsEntry)

/** Server reference: source-mode (floor version string) or ref-mode (OCI image object) */
const ServerReference = type('string').or({ image: 'string' })

// --- Main schema ---

/**
 * The facet manifest schema — validates structure and business constraints.
 *
 * Structural validation covers field types and shapes. Narrow constraints enforce:
 * 1. At least one text asset (skills, agents, commands, or facets) must be present
 * 2. Selective facets entries must include at least one asset type selection
 */
export const FacetManifestSchema = type({
  name: 'string',
  version: 'string',
  'description?': 'string',
  'author?': 'string',
  'skills?': type.Record('string', SkillDescriptor),
  'agents?': type.Record('string', AgentDescriptor),
  'commands?': type.Record('string', CommandDescriptor),
  'facets?': FacetsEntry.array(),
  'servers?': type.Record('string', ServerReference),
}).narrow((data, ctx) => {
  // Constraint 1: at least one text asset
  const hasSkills = data.skills && Object.keys(data.skills).length > 0
  const hasAgents = data.agents && Object.keys(data.agents).length > 0
  const hasCommands = data.commands && Object.keys(data.commands).length > 0
  const hasFacets = data.facets && data.facets.length > 0

  if (!hasSkills && !hasAgents && !hasCommands && !hasFacets) {
    ctx.mustBe('Manifest must include at least one text asset (skills, agents, commands, or facets)')
  }

  // Constraint 2: selective facets entries must select at least one asset type
  if (data.facets) {
    for (let i = 0; i < data.facets.length; i++) {
      const entry = data.facets[i]
      if (typeof entry === 'object') {
        const hasSelectedSkills = entry.skills && entry.skills.length > 0
        const hasSelectedAgents = entry.agents && entry.agents.length > 0
        const hasSelectedCommands = entry.commands && entry.commands.length > 0

        if (!hasSelectedSkills && !hasSelectedAgents && !hasSelectedCommands) {
          ctx.mustBe('Selective facets entry must include at least one asset type (skills, agents, or commands)')
        }
      }
    }
  }

  // Constraint 3: asset names must not contain `.` or `..` path segments.
  // Forward slashes are permitted (facet-namespacing), so segment-wise check.
  // Empty segments (leading/trailing/double slash) are rejected too.
  // Install writes to join(baseDir, relativePathFor(type, name)) — an unchecked
  // `..` segment escapes the adapter base directory. Rejecting here stops the
  // manifest before any filesystem work begins.
  const assetNameGroups: [string, Record<string, unknown> | undefined][] = [
    ['skills', data.skills],
    ['agents', data.agents],
    ['commands', data.commands],
  ]
  for (const [group, record] of assetNameGroups) {
    if (!record) continue
    for (const key of Object.keys(record)) {
      const segments = key.split('/')
      for (const seg of segments) {
        if (seg === '' || seg === '.' || seg === '..') {
          ctx.mustBe(
            `${group} name "${key}" must not contain empty, "." or ".." path segments (asset names are used as filesystem paths)`,
          )
          break
        }
      }
    }
  }

  return true
})

/** Inferred TypeScript type for a validated facet manifest */
export type FacetManifest = typeof FacetManifestSchema.infer
