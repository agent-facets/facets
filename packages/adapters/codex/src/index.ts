import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  type AssetCapability,
  type AssetFileTarget,
  type AssetRequestContext,
  type AssetType,
  defineAdapter,
  encodeText,
  errorMessage,
  type PlanAssetInstallResult,
  planSingleFileInstall,
  planSingleFileRemoval,
  planSkillBundleInstall,
  planSkillBundleRemoval,
  readFileState,
  type SkillBundleTarget,
  stateHoldsBytes,
} from '@agent-facets/adapter'
import { type } from 'arktype'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { codexMcpServers } from './mcp-servers.ts'

/**
 * Codex per-asset metadata schema.
 *
 * Codex agents are defined in TOML with these conventional fields:
 *   - name: string (display name)
 *   - description: string (one-liner for the picker)
 *   - developer_instructions: string (system prompt / instructions body)
 *
 * Skills use standard YAML front-matter (same as claude-code / opencode).
 */
const CodexMetadataSchema = type({
  'name?': 'string',
  'description?': 'string',
  'developer_instructions?': 'string',
})

/**
 * Codex's conventional layout — two separate trees, keyed on asset type:
 *
 *   Skills  (project)  → <projectRoot>/.agents/skills/<name>/SKILL.md
 *   Skills  (user)     → ~/.agents/skills/<name>/SKILL.md
 *
 *   Agents  (project)  → <projectRoot>/.codex/agents/<name>.toml
 *   Agents  (user)     → ~/.codex/agents/<name>.toml
 *
 *   Commands (project) → <projectRoot>/.agents/commands/<name>.md
 *   Commands (user)    → ~/.agents/commands/<name>.md
 *
 * The project root comes from the request, never from the process working
 * directory: the caller may be installing into a tree it is not sitting in.
 *
 * `system` scope is unsupported; returns `null` so callers get a structured
 * `unsupported-scope` failure.
 */
function baseDirFor(context: AssetRequestContext, assetType: AssetType): string | null {
  const tree = assetType === 'agent' ? '.codex' : '.agents'
  switch (context.scope) {
    case 'user':
      return join(process.env.HOME ?? homedir(), tree)
    case 'project':
      return join(context.projectRoot, tree)
    case 'system':
      return null
  }
}

function fileTarget(baseDir: string, directory: string, name: string, extension: string): AssetFileTarget {
  return { file: join(baseDir, directory, `${name}.${extension}`), boundary: baseDir }
}

function skillTarget(baseDir: string, name: string): SkillBundleTarget {
  const root = join(baseDir, 'skills', name)
  return { root, primaryFile: join(root, 'SKILL.md'), boundary: baseDir }
}

const assets: AssetCapability = {
  async planInstall(request) {
    const baseDir = baseDirFor(request, request.assetType)
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
        return planAgentToml(fileTarget(baseDir, 'agents', request.name, 'toml'), request.content, metadata)
      case 'command':
        return planSingleFileInstall(fileTarget(baseDir, 'commands', request.name, 'md'), request.content, metadata)
    }
  },

  async planRemoval(request) {
    const baseDir = baseDirFor(request, request.assetType)
    if (baseDir === null) {
      return { ok: false, failure: { code: 'unsupported-scope', scope: request.scope } }
    }
    switch (request.assetType) {
      case 'skill':
        return planSkillBundleRemoval(skillTarget(baseDir, request.name), request.ownedCompanionPaths)
      case 'agent':
        return planSingleFileRemoval(fileTarget(baseDir, 'agents', request.name, 'toml'))
      case 'command':
        return planSingleFileRemoval(fileTarget(baseDir, 'commands', request.name, 'md'))
    }
  },
}

/**
 * Codex adapter — defines the conventions for Codex,
 * OpenAI's CLI coding agent (written in Rust).
 *
 * Skills and commands use Markdown + YAML front-matter (same pattern as
 * claude-code and opencode — Codex follows the agentskills.io standard).
 *
 * Agents use TOML (Codex's native config format). The facet body is stored
 * as the `developer_instructions` field; other metadata keys are top-level
 * TOML fields.
 */
export default defineAdapter({
  name: 'codex',

  assets,
  mcpServers: codexMcpServers,

  buildAssetMetadata(data) {
    const result = CodexMetadataSchema(data)

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

// --- TOML agent planning ---

/**
 * Plan a Codex agent file.
 *
 * The facet `content` string becomes `developer_instructions`; other metadata
 * keys become top-level TOML fields.
 *
 * Equivalence is decided on the *parsed* document, not on bytes. Re-serializing
 * TOML normalizes spacing and drops comments, so a byte comparison against
 * freshly rendered output would report drift on every install for a file whose
 * meaning never changed — and then rewrite it, destroying exactly the comments
 * the comparison was confused by.
 *
 * The transition still carries the file's *exact current bytes* as its expected
 * state, so nothing about restoring it depends on TOML round-tripping.
 */
function planAgentToml(
  target: AssetFileTarget,
  content: string,
  metadata?: Record<string, unknown>,
): PlanAssetInstallResult {
  const desired: Record<string, unknown> = { ...(metadata ?? {}) }
  if (content.trim().length > 0) {
    desired.developer_instructions = content
  }

  const current = readFileState(target.file)
  if (!current.ok) return current

  if (current.state.kind === 'regular-file') {
    const existing = parseAgentToml(current.state.contents)
    if (existing !== null && sameTomlDocument(existing, desired)) {
      return { ok: true, plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: target.file } }
    }
  }

  let rendered: string
  try {
    rendered = stringifyToml(desired)
  } catch (err) {
    return { ok: false, failure: { code: 'unrepresentable', path: target.file, detail: errorMessage(err) } }
  }

  const contents = encodeText(rendered)
  if (stateHoldsBytes(current.state, contents)) {
    return { ok: true, plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: target.file } }
  }

  return {
    ok: true,
    plan: {
      occupancy: current.state.kind === 'absent' ? 'absent' : 'divergent',
      primaryPath: target.file,
      action: {
        kind: 'mutate',
        mutations: [
          {
            kind: 'write',
            path: target.file,
            boundary: target.boundary,
            expected: current.state,
            contents,
          },
        ],
      },
    },
  }
}

/**
 * Parse an existing agent document, or `null` when it is not TOML this adapter
 * can reason about.
 *
 * Unparseable is deliberately not a failure: the file is replaced, and its
 * exact prior bytes travel with the transition, so the user can get it back.
 */
function parseAgentToml(contents: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed = parseToml(new TextDecoder().decode(contents))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Structural equality over the values a Codex agent document can hold. */
function sameTomlDocument(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  if (leftKeys.some((key, index) => key !== rightKeys[index])) return false
  return leftKeys.every((key) => sameTomlValue(left[key], right[key]))
}

function sameTomlValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => sameTomlValue(value, right[index]))
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    return sameTomlDocument(left as Record<string, unknown>, right as Record<string, unknown>)
  }
  return left === right
}
