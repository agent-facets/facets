import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type AssetType,
  defineAdapter,
  deleteAssetFile,
  installAssetFile,
  readAssetFile,
  type Scope,
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

  async installAsset(scope, assetType, name, content, metadata) {
    const path = resolvePath(scope, assetType, name)

    if (assetType === 'agent') {
      await installAgentToml(path, content, metadata as Record<string, unknown>)
    } else {
      await installAssetFile({ file: path }, content, metadata as Record<string, unknown>)
    }
  },

  async readAsset(scope, assetType, name) {
    const path = resolvePath(scope, assetType, name)

    if (assetType === 'agent') {
      return readAgentToml(path)
    }

    return readAssetFile({ file: path })
  },

  async deleteAsset(scope, assetType, name) {
    const path = resolvePath(scope, assetType, name)

    if (assetType === 'agent') {
      await rm(path, { force: true })
    } else {
      await deleteAssetFile({ file: path })
    }
  },
})

// --- path resolution ---

function resolvePath(scope: Scope, assetType: AssetType, name: string): string {
  return join(baseDirFor(scope, assetType), relativePathFor(assetType, name))
}

function baseDirFor(scope: Scope, assetType: AssetType): string {
  const home = process.env.HOME ?? homedir()

  switch (scope) {
    case 'user': {
      // Agents live in ~/.codex/; skills + commands live in ~/.agents/
      if (assetType === 'agent') return join(home, '.codex')
      return join(home, '.agents')
    }
    case 'project': {
      // Agents live in .codex/; skills + commands live in .agents/
      if (assetType === 'agent') return join(process.cwd(), '.codex')
      return join(process.cwd(), '.agents')
    }
    case 'system':
      throw new Error('codex adapter: system scope is not supported')
  }
}

function relativePathFor(assetType: AssetType, name: string): string {
  switch (assetType) {
    case 'skill':
      return join('skills', name, 'SKILL.md')
    case 'agent':
      return join('agents', `${name}.toml`)
    case 'command':
      return join('commands', `${name}.md`)
  }
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
async function installAgentToml(filePath: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })

  const doc: Record<string, unknown> = { ...(metadata ?? {}) }
  if (content.trim().length > 0) {
    doc.developer_instructions = content
  }

  await Bun.write(filePath, stringifyToml(doc))
}

/**
 * Read a Codex agent TOML file. Returns `developer_instructions` as `content`
 * and the remaining top-level keys as `metadata`.
 *
 * Throws if the file is missing or contains malformed TOML — mirroring the
 * shared `readAssetFile` helper used for skills and commands, so a missing
 * agent surfaces as a read failure rather than silently returning empty.
 */
async function readAgentToml(filePath: string): Promise<{ content: string; metadata?: Record<string, unknown> }> {
  const raw = await Bun.file(filePath).text()
  const parsed = parseToml(raw) as Record<string, unknown>

  const { developer_instructions, ...rest } = parsed
  const content = typeof developer_instructions === 'string' ? developer_instructions : ''
  const metadata = Object.keys(rest).length > 0 ? rest : undefined

  return { content, metadata }
}
