import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  type AssetCapability,
  type AssetFileTarget,
  type AssetRequestContext,
  defineAdapter,
  planSingleFileInstall,
  planSingleFileRemoval,
  planSkillBundleInstall,
  planSkillBundleRemoval,
  type SkillBundleTarget,
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
 * OpenCode's conventional layout:
 *
 *   user scope    → $XDG_CONFIG_HOME/opencode, else ~/.config/opencode
 *   project scope → <projectRoot>/.opencode
 *
 *   skill   → skills/<name>/SKILL.md (+ companions below skills/<name>/)
 *   agent   → agents/<name>.md
 *   command → commands/<name>.md
 *
 * The project root comes from the request, never from the process working
 * directory: the caller may be installing into a tree it is not sitting in.
 *
 * `system` scope is unsupported; returns `null` so callers get a structured
 * `unsupported-scope` failure.
 */
function baseDirFor(context: AssetRequestContext): string | null {
  switch (context.scope) {
    case 'user': {
      const xdg = process.env.XDG_CONFIG_HOME
      if (xdg && xdg.length > 0) return join(xdg, 'opencode')
      const home = process.env.HOME ?? homedir()
      return join(home, '.config', 'opencode')
    }
    case 'project':
      return join(context.projectRoot, '.opencode')
    case 'system':
      return null
  }
}

/**
 * The base directory doubles as the mutation boundary: everything this adapter
 * plans lives strictly inside its own tree, and the tree itself is never
 * created or removed by an install.
 */
function fileTarget(baseDir: string, directory: string, name: string): AssetFileTarget {
  return { file: join(baseDir, directory, `${name}.md`), boundary: baseDir }
}

function skillTarget(baseDir: string, name: string): SkillBundleTarget {
  const root = join(baseDir, 'skills', name)
  return { root, primaryFile: join(root, 'SKILL.md'), boundary: baseDir }
}

const assets: AssetCapability = {
  async planInstall(request) {
    const baseDir = baseDirFor(request)
    if (baseDir === null) {
      return { ok: false, failure: { code: 'unsupported-scope', scope: request.scope } }
    }
    const metadata = request.metadata as Record<string, unknown>
    switch (request.assetType) {
      case 'skill':
        return planSkillBundleInstall(skillTarget(baseDir, request.name), {
          content: request.content,
          metadata,
          companions: request.companions,
          ownedCompanionPaths: request.ownedCompanionPaths,
        })
      case 'agent':
        return planSingleFileInstall(fileTarget(baseDir, 'agents', request.name), request.content, metadata)
      case 'command':
        return planSingleFileInstall(fileTarget(baseDir, 'commands', request.name), request.content, metadata)
    }
  },

  async planRemoval(request) {
    const baseDir = baseDirFor(request)
    if (baseDir === null) {
      return { ok: false, failure: { code: 'unsupported-scope', scope: request.scope } }
    }
    switch (request.assetType) {
      case 'skill':
        return planSkillBundleRemoval(skillTarget(baseDir, request.name), request.ownedCompanionPaths)
      case 'agent':
        return planSingleFileRemoval(fileTarget(baseDir, 'agents', request.name))
      case 'command':
        return planSingleFileRemoval(fileTarget(baseDir, 'commands', request.name))
    }
  },
}

/**
 * OpenCode adapter — defines the conventions for OpenCode,
 * an AI coding tool built on top of LLMs.
 */
export default defineAdapter({
  name: 'opencode',

  assets,
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
})
