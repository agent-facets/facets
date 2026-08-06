import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  type DeleteAssetRequest,
  defineAdapter,
  deleteSingleFileAsset,
  deleteSkillBundle,
  type InstallAssetRequest,
  installSingleFileAsset,
  installSkillBundle,
  type ReadAssetRequest,
  readSingleFileAsset,
  readSkillBundle,
  type Scope,
  type SkillBundlePaths,
} from '@agent-facets/adapter'
import { type } from 'arktype'
import { openCodeMcpServers } from './mcp-servers.ts'

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

  mcpServers: openCodeMcpServers,

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

  async installAsset(request: InstallAssetRequest) {
    const baseDir = baseDirFor(request.scope)
    if (baseDir === null) {
      return { ok: false as const, failure: { code: 'unsupported-scope' as const, scope: request.scope } }
    }
    switch (request.assetType) {
      case 'skill':
        return installSkillBundle(skillPaths(baseDir, request.name), {
          content: request.content,
          metadata: request.metadata as Record<string, unknown>,
          companions: request.companions,
          ownedCompanionPaths: request.ownedCompanionPaths,
        })
      case 'agent':
        return installSingleFileAsset(
          { file: join(baseDir, 'agents', `${request.name}.md`) },
          request.content,
          request.metadata as Record<string, unknown>,
        )
      case 'command':
        return installSingleFileAsset(
          { file: join(baseDir, 'commands', `${request.name}.md`) },
          request.content,
          request.metadata as Record<string, unknown>,
        )
    }
  },

  async readAsset(request: ReadAssetRequest) {
    const baseDir = baseDirFor(request.scope)
    if (baseDir === null) {
      return { ok: false as const, failure: { code: 'unsupported-scope' as const, scope: request.scope } }
    }
    switch (request.assetType) {
      case 'skill':
        return readSkillBundle(skillPaths(baseDir, request.name), request.ownedCompanionPaths)
      case 'agent':
        return readSingleFileAsset({ file: join(baseDir, 'agents', `${request.name}.md`) }, 'agent')
      case 'command':
        return readSingleFileAsset({ file: join(baseDir, 'commands', `${request.name}.md`) }, 'command')
    }
  },

  async deleteAsset(request: DeleteAssetRequest) {
    const baseDir = baseDirFor(request.scope)
    if (baseDir === null) {
      return { ok: false as const, failure: { code: 'unsupported-scope' as const, scope: request.scope } }
    }
    switch (request.assetType) {
      case 'skill':
        return deleteSkillBundle(skillPaths(baseDir, request.name), request.ownedCompanionPaths)
      case 'agent':
        return deleteSingleFileAsset({ file: join(baseDir, 'agents', `${request.name}.md`), pruneBoundary: baseDir })
      case 'command':
        return deleteSingleFileAsset({ file: join(baseDir, 'commands', `${request.name}.md`), pruneBoundary: baseDir })
    }
  },
})

/**
 * OpenCode's conventional layout:
 *
 *   user scope    → ~/.config/opencode (or $XDG_CONFIG_HOME/opencode)
 *   project scope → <cwd>/.opencode
 *
 *   skill   → skills/<name>/SKILL.md (+ companions below skills/<name>/)
 *   agent   → agents/<name>.md
 *   command → commands/<name>.md
 *
 * `<name>` may contain forward slashes for facet-namespacing (e.g.,
 * `viper-plans/planning` → `skills/viper-plans/planning/SKILL.md`).
 *
 * `system` scope is unsupported; returns `null` so callers can produce a
 * structured `unsupported-scope` failure.
 */
function baseDirFor(scope: Scope): string | null {
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
      return null
  }
}

function skillPaths(baseDir: string, name: string): SkillBundlePaths {
  const root = join(baseDir, 'skills', name)
  return { root, primaryFile: join(root, 'SKILL.md'), pruneBoundary: baseDir }
}
