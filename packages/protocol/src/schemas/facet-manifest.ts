import type { AssetType } from '@agent-facets/common'
import { type } from 'arktype'
import { planArchiveEntries } from '../build/archive-plan.ts'
import { ASSET_DIRECTORY, portableCollisionKey } from '../materialization/identity.ts'
import { materializationNamespace } from '../materialization/namespace.ts'
import { validateAssetNameSegment } from './asset-name.ts'
import { validateFacetName } from './facet-name.ts'
import { McpServerDeclarationSchema, validateMcpServerName } from './mcp-server.ts'

// --- Sub-schemas ---

/**
 * Skill descriptor — description is required, prompt resolved from
 * skills/<name>/SKILL.md. `files` declares exact companion paths relative to
 * the skill directory (design D1); the path grammar, site rules, and
 * collision freedom are enforced by the archive-plan narrow below.
 */
const SkillDescriptor = type({
  description: 'string',
  'adapters?': type.Record('string', 'unknown'),
  'files?': 'string[]',
})

/** Agent descriptor — description is required, prompt resolved from agents/<name>.md */
const AgentDescriptor = type({
  description: 'string',
  'adapters?': type.Record('string', 'unknown'),
})

/**
 * Command descriptor — description is required, prompt resolved from commands/<name>.md.
 *
 * `adapters` is permitted here (symmetrically with skills/agents) so a facet
 * can attach adapter-specific front-matter (e.g. Claude's per-command
 * permissions block) to commands. Materialize passes the block through as
 * extra front-matter keys — see `materialize.ts#adapterExtrasFor`.
 */
const CommandDescriptor = type({
  description: 'string',
  'adapters?': type.Record('string', 'unknown'),
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

// --- Main schema ---

/**
 * The facet manifest schema — validates structure and business constraints.
 *
 * Structural validation covers field types and shapes. Narrow constraints enforce:
 * 1. At least one text asset (skills, agents, commands, or facets) must be present
 * 2. Selective facets entries must include at least one asset type selection
 * 3. Asset names must satisfy the Agent Skills grammar as a SINGLE segment
 *    (validateAssetNameSegment from ./asset-name.ts): 1-64 chars, lowercase
 *    letters/digits/hyphens, no leading/trailing/consecutive hyphens, no `/`.
 *    Slash-namespaced names are legacy-`0.1`-only (LegacyFacetManifestSchema).
 *    The grammar subsumes path safety (empty, `.`, `..`, and backslash
 *    segments all fail), so it replaces the weaker path-only guard for
 *    manifest keys.
 * 4. The facet identity `name` must be a valid facet name — an unscoped slug
 *    or a scoped `@scope/name` (validateFacetName). Asset names and facet
 *    identities intentionally diverge: asset names stay local kebab segments
 *    (digit-start allowed, never scoped); facet identities may carry a
 *    registry scope.
 * 5. Skills and commands share one logical namespace (design D9): a skill and
 *    a command must not use the same name. Agents remain separate and may
 *    share a name with a skill or command.
 * 6. Supplementary `files` declarations (top-level and per-skill) must satisfy
 *    the portable path grammar and be collision-free across the whole planned
 *    archive-entry set — enforced by the shared archive-plan derivation
 *    (design D3/D7), so a manifest that validates here always yields a valid
 *    archive plan.
 */
export const FacetManifestSchema = type({
  name: 'string',
  version: 'string',
  'description?': 'string',
  'author?': 'string',
  // Optional facet privacy declaration. `private: true` declares private
  // publish intent; `private: false` or omission is public-by-default. The
  // field is recognized (not unknown extension data) so non-boolean values
  // are rejected with a `private`-pathed error. No default is injected:
  // omission stays omission in validated data (see protocol__schemas spec).
  'private?': 'boolean',
  'skills?': type.Record('string', SkillDescriptor),
  'agents?': type.Record('string', AgentDescriptor),
  'commands?': type.Record('string', CommandDescriptor),
  'facets?': FacetsEntry.array(),
  // Concrete, portable MCP server declarations (design D1). Each value is a
  // closed tagged union — the only place in this manifest where unrecognized
  // members are rejected, because every field affects process execution or
  // network access. Speculative version-string and `{ image }` references are
  // no longer representable.
  'servers?': type.Record('string', McpServerDeclarationSchema),
  // Top-level supplementary files: exact repo-relative paths for archive-only
  // files (README.md, LICENSE, ...). Shipped and hashed, never materialized.
  // Must not resolve under skills/ — skill companions have exactly one
  // declaration site (design D1).
  'files?': 'string[]',
}).narrow((data, ctx) => {
  // Constraint 0: the facet identity name must be a valid facet name. Either
  // an unscoped slug (`cowsay`) or a scoped `@scope/name` (`@julian/cowsay`).
  // This intentionally tightens the previous `name: string` behavior so
  // malformed local identities fail at manifest validation instead of
  // deferring failure to build/publish/install. Asset names are governed
  // separately by validateAssetName (Constraint 3).
  const facetName = validateFacetName(data.name)
  if (!facetName.ok) {
    ctx.mustBe(`a valid facet name: ${facetName.reason}`)
  }

  // Constraint 1: at least one deliverable. A concrete MCP server declaration
  // is a deliverable in its own right, so a server-only facet is valid: the
  // declaration ships inside the integrity-protected manifest and needs no
  // text asset to carry it. The legacy `0.1` schema keeps the older
  // text-asset-only rule, which is correct there because legacy manifests
  // cannot declare servers at all.
  const hasSkills = data.skills && Object.keys(data.skills).length > 0
  const hasAgents = data.agents && Object.keys(data.agents).length > 0
  const hasCommands = data.commands && Object.keys(data.commands).length > 0
  const hasFacets = data.facets && data.facets.length > 0
  const hasServers = data.servers && Object.keys(data.servers).length > 0

  if (!hasSkills && !hasAgents && !hasCommands && !hasFacets && !hasServers) {
    ctx.mustBe('Manifest must include at least one deliverable (skills, agents, commands, facets, or servers)')
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

  // Constraint 3: asset names must satisfy the Agent Skills grammar as a
  // single segment (see ./asset-name.ts). Current-format names are never
  // slash-namespaced — multi-segment parsing is isolated to the legacy `0.1`
  // schema (facet-manifest-legacy.ts). Because the grammar rejects empty,
  // `.`, `..`, and backslash segments, it also subsumes the filesystem
  // safety the install pipeline needs when writing join(baseDir,
  // relativePathFor(type, name)). The lockfile schemas intentionally keep the
  // weaker `@agent-facets/common` path-safety guard so legacy installs with
  // non-kebab asset names still load and can be removed.
  const assetGroups: [AssetType, Record<string, unknown> | undefined][] = [
    ['skill', data.skills],
    ['agent', data.agents],
    ['command', data.commands],
  ]
  for (const [assetType, record] of assetGroups) {
    if (!record) continue
    for (const key of Object.keys(record)) {
      const check = validateAssetNameSegment(key)
      if (!check.ok) {
        ctx.mustBe(`${ASSET_DIRECTORY[assetType]} name "${key}" ${check.reason}`)
      }
    }
  }

  // Constraint 4: server names use the same single-segment grammar as asset
  // names so exactly one spelling is portable across a JSON object key, a
  // JSONC object key, and a TOML table key. Servers deliberately occupy a
  // namespace SEPARATE from every text asset, so they are validated here and
  // excluded from the shared-namespace check below: a facet may declare both
  // skill `review` and server `review`, because their materialization
  // identities never address the same thing.
  if (data.servers) {
    for (const key of Object.keys(data.servers)) {
      const check = validateMcpServerName(key)
      if (!check.ok) {
        ctx.mustBe(`servers name "${key}" ${check.reason}`)
      }
    }
  }

  // Constraint 5: asset types that share a materialization namespace must
  // use disjoint names (design D9). A facet declaring both skill `review`
  // and command `review` is invalid; the error identifies every conflicting
  // declaration. Agents occupy their own namespace and are unaffected.
  //
  // The pairing is derived from the published `MATERIALIZATION_NAMESPACE`
  // map rather than restated here, so a new asset type cannot silently
  // escape this check by simply not appearing in a hand-written condition.
  // Names are folded with the shared portable key for defense in depth:
  // Constraint 3 already restricts names to lowercase ASCII, so the fold is
  // a no-op today, but it means this check can never be the weak link.
  const declarationsByNamespacedName = new Map<string, { name: string; groups: string[] }>()
  for (const [assetType, record] of assetGroups) {
    if (!record) continue
    for (const name of Object.keys(record)) {
      const key = `${materializationNamespace(assetType)}\u0000${portableCollisionKey(name)}`
      const existing = declarationsByNamespacedName.get(key)
      if (existing) {
        existing.groups.push(ASSET_DIRECTORY[assetType])
      } else {
        declarationsByNamespacedName.set(key, { name, groups: [ASSET_DIRECTORY[assetType]] })
      }
    }
  }
  for (const { name, groups } of declarationsByNamespacedName.values()) {
    if (groups.length < 2) continue
    const sites = groups.map((group) => `${group}.${name}`)
    ctx.mustBe(
      `${groups.join(' and ')} share one namespace: "${name}" is declared as ${
        sites.length === 2 ? 'both ' : ''
      }${sites.join(' and ')}`,
    )
  }

  // Constraint 6: supplementary declarations must yield a valid archive plan
  // (design D3/D7): portable path grammar, declaration-site rules, and
  // collision freedom across the whole planned entry set. Delegating to the
  // shared derivation keeps this schema and every downstream consumer
  // (build collection, hashing, verification) agreeing on one grammar.
  const plan = planArchiveEntries(data)
  if (!plan.ok) {
    for (const error of plan.errors) {
      ctx.mustBe(error.path ? `${error.path}: ${error.message}` : error.message)
    }
  }

  return true
})

/** Inferred TypeScript type for a validated facet manifest */
export type FacetManifest = typeof FacetManifestSchema.infer
