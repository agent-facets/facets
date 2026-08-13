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
import { claudeCodeMcpServers } from './mcp-servers.ts'

/** Claude Code per-asset metadata schema */
const ClaudeCodeMetadataSchema = type({
  'tools?': type.Record('string', 'boolean'),
  'permissions?': type.Record('string', 'boolean'),
})

/**
 * Claude Code's conventional layout:
 *
 *   user scope    → ~/.claude
 *   project scope → <projectRoot>/.claude
 *
 *   skill   → skills/<name>/SKILL.md (+ companions below skills/<name>/)
 *   agent   → agents/<name>.md
 *   command → commands/<name>.md
 *
 * The project root comes from the request, never from the process working
 * directory: the caller may be installing into a tree it is not sitting in,
 * and deriving it locally would silently materialize assets somewhere else.
 *
 * `system` scope is unsupported; returns `null` so callers get a structured
 * `unsupported-scope` failure.
 */
function baseDirFor(context: AssetRequestContext): string | null {
  switch (context.scope) {
    case 'user': {
      const home = process.env.HOME ?? homedir()
      return join(home, '.claude')
    }
    case 'project':
      return join(context.projectRoot, '.claude')
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
 * Claude Code adapter — defines the conventions for Claude Code,
 * Anthropic's AI coding tool.
 */
export default defineAdapter({
  name: 'claude-code',

  assets,
  mcpServers: claudeCodeMcpServers,

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
})
