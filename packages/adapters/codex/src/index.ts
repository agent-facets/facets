import { mkdir, readdir, rm, rmdir } from 'node:fs/promises'
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
import { stringify as stringifyYaml } from 'yaml'

/**
 * Codex per-asset metadata schema.
 *
 * Codex agents are defined in TOML with these conventional fields:
 *   - name: string (display name)
 *   - description: string (one-liner for the picker)
 *   - developer_instructions: string (system prompt / instructions body)
 *
 * Skills use standard YAML front-matter (same as claude-code / opencode).
 *
 * Commands are installed as skills with an `agents/openai.yaml` sidecar (see
 * `installCommandSkill`). The optional `interface` and `dependencies` blocks
 * are command-authored pass-through for that sidecar; `policy` is accepted but
 * `allow_implicit_invocation` is always forced to `false` at install time so a
 * command can never opt back into implicit invocation. These keys are only
 * meaningful for commands — the build validator does not run command adapter
 * metadata through this schema, so they exist here for defensive tolerance and
 * documentation.
 */
const CodexMetadataSchema = type({
  'name?': 'string',
  'description?': 'string',
  'developer_instructions?': 'string',
  'interface?': 'object',
  'dependencies?': 'object',
  'policy?': 'object',
})

/**
 * Codex adapter — defines the conventions for Codex,
 * OpenAI's CLI coding agent (written in Rust).
 *
 * ## Directory layout
 *
 * Codex uses two separate directory trees depending on asset type:
 *
 *   Skills   (project) → <cwd>/.agents/skills/<name>/SKILL.md
 *   Skills   (user)    → ~/.agents/skills/<name>/SKILL.md
 *
 *   Agents   (project) → <cwd>/.codex/agents/<name>.toml
 *   Agents   (user)    → ~/.codex/agents/<name>.toml
 *
 *   Commands (project) → <cwd>/.agents/skills/<name>/SKILL.md   (+ agents/openai.yaml)
 *   Commands (user)    → ~/.agents/skills/<name>/SKILL.md       (+ agents/openai.yaml)
 *
 * ## Commands are skills
 *
 * Codex has no separate "command" concept — it only reads skills from
 * `.agents/skills`. So a facet command is installed as a Codex *skill* whose
 * `agents/openai.yaml` sets `policy.allow_implicit_invocation: false`. That
 * makes Codex skip implicit matching while explicit `$name` invocation still
 * works — i.e. command semantics on top of the skills mechanism. See
 * https://developers.openai.com/codex/skills#optional-metadata.
 *
 * ## File formats
 *
 * Skills and commands use Markdown + YAML front-matter (same pattern as
 * claude-code and opencode — Codex follows the agentskills.io standard).
 * Commands additionally write the `agents/openai.yaml` sidecar described above.
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
    } else if (assetType === 'command') {
      await installCommandSkill(path, content, metadata as Record<string, unknown>)
    } else {
      await installAssetFile({ file: path }, content, metadata as Record<string, unknown>)
    }
  },

  async readAsset(scope, assetType, name) {
    const path = resolvePath(scope, assetType, name)

    if (assetType === 'agent') {
      return readAgentToml(path)
    }

    // Commands are stored as skills (SKILL.md); the openai.yaml sidecar is
    // deterministic and not part of the round-trip identity, so reading the
    // SKILL.md is sufficient for materialize's skip-if-identical + rollback.
    return readAssetFile({ file: path })
  },

  async deleteAsset(scope, assetType, name) {
    const path = resolvePath(scope, assetType, name)

    if (assetType === 'agent') {
      await rm(path, { force: true })
    } else if (assetType === 'command') {
      await deleteCommandSkill(path)
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
      // Codex has no command concept — install commands as skills. The
      // command-vs-skill distinction is carried by the agents/openai.yaml
      // sidecar written in installCommandSkill, not by the path.
      return join('skills', name, 'SKILL.md')
  }
}

// --- command-as-skill helpers ---

/** Keys consumed by the `agents/openai.yaml` sidecar; kept out of SKILL.md front-matter. */
const OPENAI_YAML_KEYS = ['interface', 'dependencies', 'policy'] as const

/**
 * Install a facet command as a Codex skill.
 *
 * Codex only reads skills (from `.agents/skills`), so a command is written as a
 * skill directory:
 *
 *   .agents/skills/<name>/SKILL.md          — body + name/description front-matter
 *   .agents/skills/<name>/agents/openai.yaml — invocation policy + UI metadata
 *
 * The sidecar always forces `policy.allow_implicit_invocation: false`, which is
 * what gives the skill "command" semantics: Codex won't invoke it implicitly
 * from a prompt, only via explicit `$name`. `interface` and `dependencies`
 * blocks from the command author pass through untouched; `display_name` /
 * `short_description` fall back to the command's `name` / `description` when the
 * author didn't set them.
 */
async function installCommandSkill(
  filePath: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const meta = metadata ?? {}

  // SKILL.md carries only the standard skill front-matter (name/description).
  // The openai.yaml-only keys are stripped so they don't leak into the body file.
  const frontMatter: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (!OPENAI_YAML_KEYS.includes(key as (typeof OPENAI_YAML_KEYS)[number]) && key !== 'developer_instructions') {
      frontMatter[key] = value
    }
  }
  await installAssetFile({ file: filePath }, content, frontMatter)

  const sidecarPath = join(dirname(filePath), 'agents', 'openai.yaml')
  await mkdir(dirname(sidecarPath), { recursive: true })
  await Bun.write(sidecarPath, buildCommandYaml(meta))
}

/**
 * Build the `agents/openai.yaml` contents for a command-as-skill. Merges
 * author-provided `interface` / `dependencies` / `policy` blocks with the
 * required command semantics, then serialises to YAML.
 */
function buildCommandYaml(metadata: Record<string, unknown>): string {
  const iface: Record<string, unknown> = { ...(isRecord(metadata.interface) ? metadata.interface : {}) }
  if (iface.display_name === undefined && typeof metadata.name === 'string' && metadata.name.length > 0) {
    iface.display_name = metadata.name
  }
  if (
    iface.short_description === undefined &&
    typeof metadata.description === 'string' &&
    metadata.description.length > 0
  ) {
    iface.short_description = metadata.description
  }

  // allow_implicit_invocation is always forced false — a command must never opt
  // back into implicit invocation, even if the author set it true.
  const policy: Record<string, unknown> = {
    ...(isRecord(metadata.policy) ? metadata.policy : {}),
    allow_implicit_invocation: false,
  }

  const doc: Record<string, unknown> = {}
  if (Object.keys(iface).length > 0) doc.interface = iface
  doc.policy = policy
  if (isRecord(metadata.dependencies)) doc.dependencies = metadata.dependencies

  return `${stringifyYaml(doc).trimEnd()}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Delete a command that was installed as a skill.
 *
 * Only the files this adapter created are removed — `SKILL.md` and the
 * `agents/openai.yaml` sidecar — followed by a best-effort cleanup of the two
 * directories we created (`agents/` and the `<name>/` skill dir), each removed
 * only when empty. This deliberately avoids a recursive delete of the skill
 * directory: a recursive remove would also destroy an unrelated skill that
 * shares the namespace prefix (e.g. deleting command `foo` must not wipe skill
 * `foo/bar` living at `.agents/skills/foo/bar/SKILL.md`).
 */
async function deleteCommandSkill(skillMdPath: string): Promise<void> {
  const skillDir = dirname(skillMdPath)

  await deleteAssetFile({ file: skillMdPath })
  await rm(join(skillDir, 'agents', 'openai.yaml'), { force: true })

  await removeDirIfEmpty(join(skillDir, 'agents'))
  await removeDirIfEmpty(skillDir)
}

/** Remove `dir` only if it exists and is empty. No-op otherwise (never recurses). */
async function removeDirIfEmpty(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => null)
  if (entries && entries.length === 0) {
    await rmdir(dir).catch(() => {})
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
