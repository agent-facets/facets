import { type } from 'arktype'
import { validateAssetName } from './asset-name.ts'
import { validateFacetName } from './facet-name.ts'

/**
 * Legacy `0.1` facet-manifest schema — frozen at the pre-supplementary-file
 * rules so archives produced before archive format `0.2` remain consumable
 * during the compatibility window.
 *
 * Differences from the current `FacetManifestSchema`:
 *  - Asset names use the legacy multi-segment grammar (`validateAssetName`,
 *    allowing namespaced names like `viper-plans/planning`).
 *  - Skills and commands do NOT share a namespace; only same-type duplicates
 *    are invalid (and those cannot appear in JSON-parsed records anyway).
 *  - No supplementary `files` declarations are recognized. A `files` key in a
 *    legacy manifest is tolerated as unknown extension data, matching the
 *    legacy consumers' unknown-field tolerance.
 *
 * This schema is consumed only by legacy `0.1` archive verification. An
 * invalid current-format manifest MUST NOT be reinterpreted under these
 * rules (design D4/D9: no cross-version fallback).
 */

const LegacySkillDescriptor = type({
  description: 'string',
  'adapters?': type.Record('string', 'unknown'),
})

const LegacyAgentDescriptor = type({
  description: 'string',
  'adapters?': type.Record('string', 'unknown'),
})

const LegacyCommandDescriptor = type({
  description: 'string',
  'adapters?': type.Record('string', 'unknown'),
})

const LegacySelectiveFacetsEntry = type({
  name: 'string',
  version: 'string',
  'skills?': 'string[]',
  'agents?': 'string[]',
  'commands?': 'string[]',
})

const LegacyFacetsEntry = type('string').or(LegacySelectiveFacetsEntry)

const LegacyServerReference = type('string').or({ image: 'string' })

export const LegacyFacetManifestSchema = type({
  name: 'string',
  version: 'string',
  'description?': 'string',
  'author?': 'string',
  'private?': 'boolean',
  'skills?': type.Record('string', LegacySkillDescriptor),
  'agents?': type.Record('string', LegacyAgentDescriptor),
  'commands?': type.Record('string', LegacyCommandDescriptor),
  'facets?': LegacyFacetsEntry.array(),
  'servers?': type.Record('string', LegacyServerReference),
}).narrow((data, ctx) => {
  const facetName = validateFacetName(data.name)
  if (!facetName.ok) {
    ctx.mustBe(`a valid facet name: ${facetName.reason}`)
  }

  const hasSkills = data.skills && Object.keys(data.skills).length > 0
  const hasAgents = data.agents && Object.keys(data.agents).length > 0
  const hasCommands = data.commands && Object.keys(data.commands).length > 0
  const hasFacets = data.facets && data.facets.length > 0

  if (!hasSkills && !hasAgents && !hasCommands && !hasFacets) {
    ctx.mustBe('Manifest must include at least one text asset (skills, agents, commands, or facets)')
  }

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

  // Legacy asset-name rules: multi-segment names permitted, every segment
  // validated against the Agent Skills grammar.
  const assetNameGroups: [string, Record<string, unknown> | undefined][] = [
    ['skills', data.skills],
    ['agents', data.agents],
    ['commands', data.commands],
  ]
  for (const [group, record] of assetNameGroups) {
    if (!record) continue
    for (const key of Object.keys(record)) {
      const check = validateAssetName(key)
      if (!check.ok) {
        ctx.mustBe(`${group} name "${key}" ${check.reason}`)
      }
    }
  }

  return true
})

/** Inferred TypeScript type for a validated legacy (`0.1`) facet manifest */
export type LegacyFacetManifest = typeof LegacyFacetManifestSchema.infer
