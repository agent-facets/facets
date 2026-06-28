import { join } from 'node:path'
import {
  type AssetType,
  defineAdapter,
  deleteAssetFile,
  installAssetFile,
  readAssetFile,
  type Scope,
} from '@agent-facets/adapter'
import { type } from 'arktype'

/**
 * GitHub Copilot per-asset metadata schema.
 *
 * Copilot's customization files use YAML front-matter, but the meaningful
 * fields differ per asset type:
 *   - instructions/skills → `applyTo` (glob), `name`, `description`,
 *     `user-invocable`, `disable-model-invocation`, `context`
 *   - prompts (commands)  → `description`, `name`, `argument-hint`, `agent`,
 *     `model`, `tools`
 *   - agents              → own instructions + `tools` + `model`
 *
 * The schema is intentionally permissive — every field is optional — so a
 * single adapter can serve all three asset types without rejecting valid
 * front-matter for a type it isn't currently writing.
 */
const CopilotMetadataSchema = type({
  'applyTo?': 'string',
  'description?': 'string',
  'name?': 'string',
  'argument-hint?': 'string',
  'agent?': 'string',
  'model?': 'string',
  'tools?': 'string[]',
  'user-invocable?': 'boolean',
  'disable-model-invocation?': 'boolean',
  'context?': 'string',
})

/**
 * GitHub Copilot adapter — defines the conventions for GitHub Copilot's
 * repository-based customization files under `.github/`.
 *
 * ## Directory layout (project scope only)
 *
 *   skill   → <cwd>/.github/skills/<name>/SKILL.md
 *   agent   → <cwd>/.github/agents/<name>.agent.md
 *   command → <cwd>/.github/prompts/<name>.prompt.md
 *
 * Copilot's customization is repository-based and has no stable
 * cross-platform user-scope directory, so `user` and `system` scopes throw.
 */
export default defineAdapter({
  name: 'copilot',
  supportsInstall: true,

  buildAssetMetadata(data) {
    const result = CopilotMetadataSchema(data)

    if (result instanceof type.errors) {
      return {
        ok: false,
        errors: result.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          expected: err.expected ?? 'unknown',
          actual: String(err.actual ?? 'unknown'),
        })),
      }
    }

    return { ok: true, data: result as Record<string, unknown> }
  },

  async installAsset(scope, assetType, name, content, metadata) {
    return installAssetFile({ file: resolvePath(scope, assetType, name) }, content, metadata as Record<string, unknown>)
  },

  async readAsset(scope, assetType, name) {
    return readAssetFile({ file: resolvePath(scope, assetType, name) })
  },

  async deleteAsset(scope, assetType, name) {
    return deleteAssetFile({ file: resolvePath(scope, assetType, name) })
  },
})

/**
 * Resolve the absolute path for an asset under GitHub Copilot's conventional
 * `.github/` layout.
 *
 *   project scope → <cwd>/.github
 *
 *   skill   → skills/<name>/SKILL.md
 *   agent   → agents/<name>.agent.md
 *   command → prompts/<name>.prompt.md
 *
 * `<name>` may contain forward slashes for facet-namespacing (e.g.,
 * `viper-plans/planning` → `skills/viper-plans/planning/SKILL.md`).
 */
function resolvePath(scope: Scope, assetType: AssetType, name: string): string {
  return join(baseDirFor(scope), relativePathFor(assetType, name))
}

function baseDirFor(scope: Scope): string {
  switch (scope) {
    case 'project':
      return join(process.cwd(), '.github')
    case 'user':
      throw new Error('copilot adapter: user scope is not supported')
    case 'system':
      throw new Error('copilot adapter: system scope is not supported')
  }
}

function relativePathFor(assetType: AssetType, name: string): string {
  switch (assetType) {
    case 'skill':
      return join('skills', name, 'SKILL.md')
    case 'agent':
      return join('agents', `${name}.agent.md`)
    case 'command':
      return join('prompts', `${name}.prompt.md`)
  }
}
