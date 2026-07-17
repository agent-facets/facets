import { mkdir, readdir, rm, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type AssetType,
  defineAdapter,
  deleteAssetFile,
  installAssetFile,
  normalizeAssetContent,
  readAssetFile,
  type Scope,
} from '@agent-facets/adapter'
import { type } from 'arktype'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

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
      await installCommandSkill(path, content, metadata as Record<string, unknown>, legacyCommandPath(scope, name))
    } else {
      await installAssetFile({ file: path }, content, metadata as Record<string, unknown>)
    }
  },

  normalizeForCompare(assetType, content, metadata) {
    if (assetType === 'agent') {
      // TOML agents round-trip verbatim: `content` becomes the
      // `developer_instructions` field and comes back unchanged — no YAML
      // front-matter split. Mirroring `installAgentToml`/`readAgentToml`
      // exactly is what keeps agents whose prompts *contain* a `---`
      // front-matter block idempotent on re-install (TASK-192): the
      // default YAML normalization would strip that block from the
      // candidate and never match the on-disk TOML round-trip.
      //
      // Edge: `installAgentToml` omits `developer_instructions` for
      // whitespace-only content, and `readAgentToml` then yields `''`.
      return { content: content.trim().length > 0 ? content : '', metadata }
    }

    if (assetType === 'command') {
      // Commands are installed as skills: SKILL.md carries the standard
      // front-matter, and the sidecar-routed keys (`interface` /
      // `dependencies` / `policy`) are derived into `agents/openai.yaml`.
      // `readAsset` folds BOTH back into metadata, so the candidate must be
      // derived the same way (front-matter split+merge, then the exact
      // sidecar doc `buildCommandSidecarDoc` would emit). Matching this shape
      // — including the forced `allow_implicit_invocation: false` and the
      // display_name/short_description defaults — is what keeps commands
      // idempotent AND lets skip-if-identical detect sidecar drift.
      const frontMatter = stripSidecarKeys(metadata)
      const base = normalizeAssetContent(content, frontMatter)
      return { content: base.content, metadata: { ...base.metadata, ...buildCommandSidecarDoc(metadata) } }
    }

    // Skills use the standard YAML front-matter model.
    return normalizeAssetContent(content, metadata)
  },

  resolvePath(scope, assetType, name) {
    return resolvePath(scope, assetType, name)
  },

  async readAsset(scope, assetType, name) {
    const path = resolvePath(scope, assetType, name)

    if (assetType === 'agent') {
      return readAgentToml(path)
    }

    if (assetType === 'command') {
      // Commands are stored as skills (SKILL.md) plus an `agents/openai.yaml`
      // sidecar. Reading BOTH — and folding the sidecar-routed keys back into
      // metadata — is what lets materialize's skip-if-identical detect drift
      // in the sidecar (a hand-edited or deleted openai.yaml, e.g. flipping
      // `allow_implicit_invocation` back to true). Without it the sidecar
      // could silently drift and never be repaired.
      return readCommandSkill(path)
    }

    return readAssetFile({ file: path })
  },

  async deleteAsset(scope, assetType, name) {
    const path = resolvePath(scope, assetType, name)

    if (assetType === 'agent') {
      await rm(path, { force: true })
    } else if (assetType === 'command') {
      await deleteCommandSkill(path, legacyCommandPath(scope, name), join(baseDirFor(scope, 'command'), 'skills'))
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
 * Strip the sidecar-routed keys (and `developer_instructions`, which is an
 * agent-only concept) from a metadata bag, leaving only what belongs in
 * SKILL.md front-matter (`name` / `description` + any author extras). Shared
 * by `installCommandSkill` (what it writes) and `normalizeForCompare` (what
 * it derives), so the two never drift.
 */
function stripSidecarKeys(metadata: Record<string, unknown>): Record<string, unknown> {
  const frontMatter: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!OPENAI_YAML_KEYS.includes(key as (typeof OPENAI_YAML_KEYS)[number]) && key !== 'developer_instructions') {
      frontMatter[key] = value
    }
  }
  return frontMatter
}

/**
 * Install a facet command as a Codex skill.
 *
 * Codex only reads skills (from `.agents/skills`), so a command is written as a
 * skill directory:
 *
 *   .agents/skills/<name>/SKILL.md           — body + name/description front-matter
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
  metadata: Record<string, unknown> | undefined,
  legacyPath: string,
): Promise<void> {
  const meta = metadata ?? {}

  // SKILL.md carries only the standard skill front-matter (name/description).
  // The openai.yaml-only keys are stripped so they don't leak into the body file.
  await installAssetFile({ file: filePath }, content, stripSidecarKeys(meta))

  const sidecarPath = join(dirname(filePath), 'agents', 'openai.yaml')
  await mkdir(dirname(sidecarPath), { recursive: true })
  await Bun.write(sidecarPath, buildCommandYaml(meta))

  // Legacy sweep: earlier adapter versions installed commands at
  // `.agents/commands/<name>.md`, a path Codex never read. Remove it so an
  // upgrade converges instead of orphaning the old file forever. Mirrors the
  // `.meta.json` sweep in the SDK's `deleteAssetFile`.
  await rm(legacyPath, { force: true })
}

/**
 * Read a command back from its skill directory: the SKILL.md body +
 * front-matter, with the sidecar-routed keys reconstructed from
 * `agents/openai.yaml` and folded back into metadata.
 *
 * Folding the sidecar in (rather than reading only SKILL.md) is what lets
 * materialize's skip-if-identical detect drift in `openai.yaml` — a deleted
 * or hand-edited sidecar (e.g. an author flipping `allow_implicit_invocation`
 * back to `true`) now differs from the derived candidate and is repaired.
 */
async function readCommandSkill(skillMdPath: string): Promise<{ content: string; metadata?: Record<string, unknown> }> {
  const base = await readAssetFile({ file: skillMdPath })
  const frontMatter = base.metadata ?? {}

  const sidecarPath = join(dirname(skillMdPath), 'agents', 'openai.yaml')
  const raw = await Bun.file(sidecarPath)
    .text()
    .catch(() => null)
  const doc = raw !== null ? (parseYaml(raw) as Record<string, unknown>) : {}

  return { content: base.content, metadata: { ...frontMatter, ...doc } }
}

/**
 * The legacy `.agents/commands/<name>.md` path an earlier adapter version
 * wrote for a command. Computed from scope + name (not derived from the
 * skill path) so namespaced names like `viper-plans/plan` map correctly to
 * `.agents/commands/viper-plans/plan.md`.
 */
function legacyCommandPath(scope: Scope, name: string): string {
  return join(baseDirFor(scope, 'command'), 'commands', `${name}.md`)
}

/**
 * Build the `agents/openai.yaml` sidecar document (object form) for a
 * command-as-skill. Merges author-provided `interface` / `dependencies` /
 * `policy` blocks with the required command semantics.
 *
 * Shared by `buildCommandYaml` (what gets serialized to disk) and
 * `normalizeForCompare` (the derived candidate skip-if-identical compares
 * against `readCommandSkill`). Keeping one source of truth for the doc shape
 * — including key order, which JSON.stringify equality is sensitive to — is
 * what keeps commands idempotent across re-install.
 */
function buildCommandSidecarDoc(metadata: Record<string, unknown>): Record<string, unknown> {
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

  return doc
}

/** Serialize the command sidecar doc to the `agents/openai.yaml` file contents. */
function buildCommandYaml(metadata: Record<string, unknown>): string {
  return `${stringifyYaml(buildCommandSidecarDoc(metadata)).trimEnd()}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Delete a command that was installed as a skill.
 *
 * Only the files this adapter created are removed — `SKILL.md`, the
 * `agents/openai.yaml` sidecar, and the legacy `.agents/commands/<name>.md`
 * file an older adapter version may have left — followed by a best-effort
 * cleanup of the now-empty directories, each removed only when empty. This
 * deliberately avoids a recursive delete of the skill directory: a recursive
 * remove would also destroy an unrelated skill that shares the namespace
 * prefix (e.g. deleting command `foo` must not wipe skill `foo/bar` living at
 * `.agents/skills/foo/bar/SKILL.md`).
 *
 * Empty-dir cleanup walks upward from the skill dir toward `skillsRoot`
 * (exclusive) so a namespaced command like `viper-plans/plan` also prunes the
 * now-empty `.agents/skills/viper-plans/` parent — but never the shared
 * `skills/` root, and never a parent that still holds a sibling skill.
 */
async function deleteCommandSkill(skillMdPath: string, legacyPath: string, skillsRoot: string): Promise<void> {
  const skillDir = dirname(skillMdPath)

  await deleteAssetFile({ file: skillMdPath })
  await rm(join(skillDir, 'agents', 'openai.yaml'), { force: true })
  await rm(legacyPath, { force: true })

  await removeDirIfEmpty(join(skillDir, 'agents'))
  await pruneEmptyDirsUpTo(skillDir, skillsRoot)
}

/**
 * Remove `startDir` and its ancestors while they are empty, stopping before
 * `boundary` (never removed) and at the first non-empty ancestor. Guards
 * against escaping the boundary subtree.
 */
async function pruneEmptyDirsUpTo(startDir: string, boundary: string): Promise<void> {
  let dir = startDir
  while (dir !== boundary && dir.startsWith(`${boundary}/`)) {
    const removed = await removeDirIfEmpty(dir)
    if (!removed) return
    dir = dirname(dir)
  }
}

/**
 * Remove `dir` only if it exists and is empty. Returns whether it was
 * removed. No-op otherwise (never recurses).
 */
async function removeDirIfEmpty(dir: string): Promise<boolean> {
  const entries = await readdir(dir).catch(() => null)
  if (entries && entries.length === 0) {
    return rmdir(dir)
      .then(() => true)
      .catch(() => false)
  }
  return false
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
