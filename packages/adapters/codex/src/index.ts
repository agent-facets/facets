import { join } from 'node:path'
import {
  type AssetCapability,
  type AssetFileTarget,
  type AssetType,
  checkStorageRoot,
  defineAdapter,
  encodeText,
  errorMessage,
  type PlanAssetInstallResult,
  type PlanningContext,
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

/** The scopes this adapter serves. User scope arrives with its native layout. */
const SUPPORTED_SCOPES = ['project'] as const

/**
 * Codex's conventional project layout — two separate trees, keyed on asset
 * type:
 *
 *   Skills   → <projectRoot>/.agents/skills/<name>/SKILL.md
 *   Agents   → <projectRoot>/.codex/agents/<name>.toml
 *   Commands → <projectRoot>/.agents/commands/<name>.md
 *
 * The project command mapping is retained legacy behavior, not an
 * established native Codex capability; repairing it is separate work.
 *
 * The project root comes from the request's planning context, never from the
 * process working directory: the caller may be installing into a tree it is
 * not sitting in.
 *
 * Any other target returns `null`, so callers get a structured
 * `unsupported-scope` failure.
 */
function baseDirFor(context: PlanningContext, assetType: AssetType): string | null {
  const tree = assetType === 'agent' ? '.codex' : '.agents'
  return context.target.scope === 'project' ? join(context.target.projectRoot, tree) : null
}

function unsupportedScope(context: PlanningContext) {
  return {
    ok: false,
    failure: { code: 'unsupported-scope', scope: context.target.scope, supportedScopes: SUPPORTED_SCOPES },
  } as const
}

/** The base directory is the mutation boundary and the disclosed storage root for its asset type. */
function fileTarget(baseDir: string, directory: string, name: string, extension: string): AssetFileTarget {
  return { file: join(baseDir, directory, `${name}.${extension}`), boundary: baseDir, storageRoot: baseDir }
}

function skillTarget(baseDir: string, name: string): SkillBundleTarget {
  const root = join(baseDir, 'skills', name)
  return { root, primaryFile: join(root, 'SKILL.md'), boundary: baseDir, storageRoot: baseDir }
}

const assets: AssetCapability = {
  supportedScopes: SUPPORTED_SCOPES,
  locationEnvironment: [],

  async planInstall(request) {
    const baseDir = baseDirFor(request.context, request.assetType)
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
        return planAgentToml(fileTarget(baseDir, 'agents', request.name, 'toml'), request.content, metadata)
      case 'command':
        return planSingleFileInstall(fileTarget(baseDir, 'commands', request.name, 'md'), request.content, metadata)
    }
  },

  async planRemoval(request) {
    const baseDir = baseDirFor(request.context, request.assetType)
    if (baseDir === null) return unsupportedScope(request.context)
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

  const contained = checkStorageRoot(target.storageRoot, target.boundary, [target.file])
  if (!contained.ok) return contained

  const current = readFileState(target.file)
  if (!current.ok) return current

  const { storageRoot } = target
  const unchanged = {
    ok: true,
    plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: target.file, storageRoot },
  } as const

  if (current.state.kind === 'regular-file') {
    const existing = parseAgentToml(current.state.contents)
    if (existing !== null && sameTomlDocument(existing, desired)) return unchanged
  }

  let rendered: string
  try {
    rendered = stringifyToml(desired)
  } catch (err) {
    return { ok: false, failure: { code: 'unrepresentable', path: target.file, detail: errorMessage(err) } }
  }

  const contents = encodeText(rendered)
  if (stateHoldsBytes(current.state, contents)) return unchanged

  return {
    ok: true,
    plan: {
      occupancy: current.state.kind === 'absent' ? 'absent' : 'divergent',
      primaryPath: target.file,
      storageRoot,
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
