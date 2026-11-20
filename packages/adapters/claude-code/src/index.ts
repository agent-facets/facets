import { join } from 'node:path'
import {
  type AssetCapability,
  type AssetFileTarget,
  defineAdapter,
  type PlanningContext,
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

/** The scopes this adapter serves. User scope arrives with its native layout. */
const SUPPORTED_SCOPES = ['project'] as const

/**
 * Claude Code's conventional project layout:
 *
 *   project scope → <projectRoot>/.claude
 *
 *   skill   → skills/<name>/SKILL.md (+ companions below skills/<name>/)
 *   agent   → agents/<name>.md
 *   command → commands/<name>.md
 *
 * The project root comes from the request's planning context, never from the
 * process working directory: the caller may be installing into a tree it is
 * not sitting in, and deriving it locally would silently materialize assets
 * somewhere else.
 *
 * Any other target returns `null`, so callers get a structured
 * `unsupported-scope` failure.
 */
function baseDirFor(context: PlanningContext): string | null {
  return context.target.scope === 'project' ? join(context.target.projectRoot, '.claude') : null
}

function unsupportedScope(context: PlanningContext) {
  return {
    ok: false,
    failure: { code: 'unsupported-scope', scope: context.target.scope, supportedScopes: SUPPORTED_SCOPES },
  } as const
}

/**
 * The base directory doubles as the mutation boundary and the disclosed
 * storage root: everything this adapter plans lives strictly inside its own
 * tree, and the tree itself is never created or removed by an install.
 */
function fileTarget(baseDir: string, directory: string, name: string): AssetFileTarget {
  return { file: join(baseDir, directory, `${name}.md`), boundary: baseDir, storageRoot: baseDir }
}

function skillTarget(baseDir: string, name: string): SkillBundleTarget {
  const root = join(baseDir, 'skills', name)
  return { root, primaryFile: join(root, 'SKILL.md'), boundary: baseDir, storageRoot: baseDir }
}

const assets: AssetCapability = {
  supportedScopes: SUPPORTED_SCOPES,
  locationEnvironment: [],

  async planInstall(request) {
    const baseDir = baseDirFor(request.context)
    if (baseDir === null) return unsupportedScope(request.context)
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
    const baseDir = baseDirFor(request.context)
    if (baseDir === null) return unsupportedScope(request.context)
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
