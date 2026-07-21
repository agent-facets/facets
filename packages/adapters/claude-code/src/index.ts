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
 * Claude Code's conventional layout:
 *
 *   user scope    → ~/.claude
 *   project scope → <cwd>/.claude
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
      const home = process.env.HOME ?? homedir()
      return join(home, '.claude')
    }
    case 'project':
      return join(process.cwd(), '.claude')
    case 'system':
      return null
  }
}

function skillPaths(baseDir: string, name: string): SkillBundlePaths {
  const root = join(baseDir, 'skills', name)
  return { root, primaryFile: join(root, 'SKILL.md'), pruneBoundary: baseDir }
}
