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

/** Claude Code per-asset metadata schema */
const ClaudeCodeMetadataSchema = type({
  'tools?': type.Record('string', 'boolean'),
  'permissions?': type.Record('string', 'boolean'),
})

/**
 * Claude Code adapter — defines the conventions for Claude Code,
 * Anthropic's AI coding tool.
 */
export default defineAdapter({
  name: 'claude-code',
  supportsInstall: true,

  buildAssetMetadata(data) {
    const result = ClaudeCodeMetadataSchema(data)

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
 * Resolve the absolute path for an asset under Claude Code's conventional layout.
 *
 *   user scope    → ~/.claude
 *   project scope → <cwd>/.claude
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
      const home = process.env.HOME ?? homedir()
      return join(home, '.claude')
    }
    case 'project':
      return join(process.cwd(), '.claude')
    case 'system':
      throw new Error('claude-code adapter: system scope is not supported')
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
