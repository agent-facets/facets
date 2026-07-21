import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type DeleteAssetRequest,
  defineAdapter,
  deleteSingleFileAsset,
  deleteSkillBundle,
  errorMessage,
  type InstallAssetRequest,
  type InstallAssetResult,
  installSingleFileAsset,
  installSkillBundle,
  isMissingFileError,
  type ReadAssetRequest,
  type ReadAssetResult,
  readSingleFileAsset,
  readSkillBundle,
  type Scope,
  type SkillBundlePaths,
} from '@agent-facets/adapter'
import { type } from 'arktype'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

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
 * Codex adapter — defines the conventions for Codex,
 * OpenAI's CLI coding agent (written in Rust).
 *
 * ## Directory layout
 *
 * Codex uses two separate directory trees depending on asset type:
 *
 *   Skills  (project)  → <cwd>/.agents/skills/<name>/SKILL.md
 *   Skills  (user)     → ~/.agents/skills/<name>/SKILL.md
 *
 *   Agents  (project)  → <cwd>/.codex/agents/<name>.toml
 *   Agents  (user)     → ~/.codex/agents/<name>.toml
 *
 *   Commands (project) → <cwd>/.agents/commands/<name>.md
 *   Commands (user)    → ~/.agents/commands/<name>.md
 *
 * ## File formats
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
  supportsInstall: true,

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

  async installAsset(request: InstallAssetRequest) {
    const baseDir = baseDirFor(request.scope, request.assetType)
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
        return installAgentToml(
          join(baseDir, 'agents', `${request.name}.toml`),
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
    const baseDir = baseDirFor(request.scope, request.assetType)
    if (baseDir === null) {
      return { ok: false as const, failure: { code: 'unsupported-scope' as const, scope: request.scope } }
    }
    switch (request.assetType) {
      case 'skill':
        return readSkillBundle(skillPaths(baseDir, request.name), request.ownedCompanionPaths)
      case 'agent':
        return readAgentToml(join(baseDir, 'agents', `${request.name}.toml`))
      case 'command':
        return readSingleFileAsset({ file: join(baseDir, 'commands', `${request.name}.md`) }, 'command')
    }
  },

  async deleteAsset(request: DeleteAssetRequest) {
    const baseDir = baseDirFor(request.scope, request.assetType)
    if (baseDir === null) {
      return { ok: false as const, failure: { code: 'unsupported-scope' as const, scope: request.scope } }
    }
    switch (request.assetType) {
      case 'skill':
        return deleteSkillBundle(skillPaths(baseDir, request.name), request.ownedCompanionPaths)
      case 'agent':
        // Same lifecycle as any single-file asset: idempotent delete with
        // boundary-guarded empty-directory pruning. Codex previously left
        // empty agent directories behind; pruning is now consistent.
        return deleteSingleFileAsset({ file: join(baseDir, 'agents', `${request.name}.toml`), pruneBoundary: baseDir })
      case 'command':
        return deleteSingleFileAsset({ file: join(baseDir, 'commands', `${request.name}.md`), pruneBoundary: baseDir })
    }
  },
})

// --- path resolution ---

/**
 * Resolve the base directory for a scope + asset type. Agents live in the
 * `.codex/` tree; skills and commands live in the `.agents/` tree.
 * `system` scope is unsupported; returns `null` so callers can produce a
 * structured `unsupported-scope` failure.
 */
function baseDirFor(scope: Scope, assetType: 'skill' | 'agent' | 'command'): string | null {
  const home = process.env.HOME ?? homedir()

  switch (scope) {
    case 'user': {
      if (assetType === 'agent') return join(home, '.codex')
      return join(home, '.agents')
    }
    case 'project': {
      if (assetType === 'agent') return join(process.cwd(), '.codex')
      return join(process.cwd(), '.agents')
    }
    case 'system':
      return null
  }
}

function skillPaths(baseDir: string, name: string): SkillBundlePaths {
  const root = join(baseDir, 'skills', name)
  return { root, primaryFile: join(root, 'SKILL.md'), pruneBoundary: baseDir }
}

// --- TOML agent helpers ---

/**
 * Write a Codex agent TOML file. The facet `content` string becomes the
 * `developer_instructions` field. Other metadata keys are serialised as
 * top-level TOML fields. Overwrites unconditionally (idempotent by contract).
 *
 * Mirrors how claude-code / opencode treat content as the body and metadata
 * as the envelope — no content sniffing or format detection.
 */
async function installAgentToml(
  filePath: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<InstallAssetResult> {
  const doc: Record<string, unknown> = { ...(metadata ?? {}) }
  if (content.trim().length > 0) {
    doc.developer_instructions = content
  }

  try {
    await mkdir(dirname(filePath), { recursive: true })
    await Bun.write(filePath, stringifyToml(doc))
  } catch (err) {
    return {
      ok: false,
      failure: { code: 'io-failed', operation: 'write', path: filePath, message: errorMessage(err) },
    }
  }
  return { ok: true, primaryPath: filePath }
}

/**
 * Read a Codex agent TOML file. Returns `developer_instructions` as the
 * canonical `content` and the remaining top-level keys as `metadata` —
 * the TOML envelope is Codex's storage encoding, stripped on read so
 * callers can compare canonical logical content.
 *
 * A missing file is a structured `not-found`; malformed TOML is `io-failed`.
 */
async function readAgentToml(filePath: string): Promise<ReadAssetResult> {
  let raw: string
  try {
    raw = await readTextFile(filePath)
  } catch (err) {
    if (isMissingFileError(err)) return { ok: false, failure: { code: 'not-found' } }
    return {
      ok: false,
      failure: { code: 'io-failed', operation: 'read', path: filePath, message: errorMessage(err) },
    }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parseToml(raw) as Record<string, unknown>
  } catch (err) {
    return {
      ok: false,
      failure: { code: 'io-failed', operation: 'read', path: filePath, message: errorMessage(err) },
    }
  }

  const { developer_instructions, ...rest } = parsed
  const content = typeof developer_instructions === 'string' ? developer_instructions : ''
  const metadata = Object.keys(rest).length > 0 ? rest : undefined

  return { ok: true, asset: { assetType: 'agent', content, metadata } }
}

/**
 * Read a text file, surfacing ENOENT as a thrown errno error. `Bun.file`'s
 * `.text()` rejects with an ENOENT-coded error for missing files, which
 * `isMissingFileError` recognizes.
 */
async function readTextFile(filePath: string): Promise<string> {
  return Bun.file(filePath).text()
}
