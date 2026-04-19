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

/** OpenCode per-asset metadata schema */
const OpenCodeMetadataSchema = type({
  'tools?': 'Record<string, boolean>',
  'model?': 'string',
  'permissions?': 'Record<string, "allow" | "deny">',
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
    await installAssetFile({ file: resolvePath(scope, assetType, name) }, content, metadata as Record<string, unknown>)
  },

  async readAsset(scope, assetType, name) {
    return readAssetFile({ file: resolvePath(scope, assetType, name) })
  },

  async deleteAsset(scope, assetType, name) {
    await deleteAssetFile({ file: resolvePath(scope, assetType, name) })
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
