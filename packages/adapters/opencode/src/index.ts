import { homedir } from 'node:os'
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
 * OpenCode per-asset metadata schema.
 *
 * A single generic schema serves every asset type because the adapter's
 * `buildAssetMetadata` hook is not asset-type-aware. Command-only keys
 * (`agent`, `subtask`) and agent-only keys (`mode`) therefore coexist here;
 * a facet only sets the keys relevant to the asset it attaches them to.
 *
 * `permission` is `Record<string, unknown>` because OpenCode permission
 * values may be a shorthand action string ("allow" | "ask" | "deny") OR a
 * nested glob/pattern → action object (e.g. `edit: { "*": "deny", "foo/**":
 * "allow" }`). Constraining it tighter would reject valid OpenCode config.
 * The legacy `permissions` key is retained unchanged for back-compat.
 */
const OpenCodeMetadataSchema = type({
  'tools?': 'Record<string, boolean>',
  'model?': 'string',
  'permissions?': 'Record<string, "allow" | "deny">',
  // OpenCode agent frontmatter
  'mode?': '"primary" | "subagent" | "all"',
  'permission?': 'Record<string, unknown>',
  // OpenCode command frontmatter — a command may target an agent and force a subtask
  'agent?': 'string',
  'subtask?': 'boolean',
})

/**
 * OpenCode adapter — defines the conventions for OpenCode,
 * an AI coding tool built on top of LLMs.
 */
export default defineAdapter({
  name: 'opencode',
  supportsInstall: true,

  buildAssetMetadata(data) {
    const result = OpenCodeMetadataSchema(data)
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
 * Resolve the absolute path for an asset under OpenCode's conventional layout.
 *
 *   user scope    → ~/.config/opencode
 *   project scope → <cwd>/.opencode
 *
 *   skill   → skills/<name>/SKILL.md
 *   agent   → agents/<name>.md
 *   command → commands/<name>.md
 *
 * `<name>` may contain forward slashes for facet-namespacing (e.g.,
 * `viper-plans/planning` → `skills/viper-plans/planning/SKILL.md`).
 */
function resolvePath(scope: Scope, assetType: AssetType, name: string): string {
  return join(baseDirFor(scope), relativePathFor(assetType, name))
}

function baseDirFor(scope: Scope): string {
  switch (scope) {
    case 'user': {
      const xdg = process.env.XDG_CONFIG_HOME
      if (xdg && xdg.length > 0) return join(xdg, 'opencode')
      const home = process.env.HOME ?? homedir()
      return join(home, '.config', 'opencode')
    }
    case 'project':
      return join(process.cwd(), '.opencode')
    case 'system':
      throw new Error('opencode adapter: system scope is not supported')
  }
}

function relativePathFor(assetType: AssetType, name: string): string {
  switch (assetType) {
    case 'skill':
      return join('skills', name, 'SKILL.md')
    case 'agent':
      return join('agents', `${name}.md`)
    case 'command':
      return join('commands', `${name}.md`)
  }
}
