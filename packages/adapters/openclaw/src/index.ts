import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  type AssetType,
  defineAdapter,
  deleteAssetFile,
  installAssetFile,
  readAssetFile,
  type Scope,
  type ValidationError,
} from '@agent-facets/adapter'
import { type } from 'arktype'

/**
 * OpenClaw per-asset metadata schema.
 *
 * OpenClaw skills follow the AgentSkills (agentskills.io) front-matter spec.
 * Every key here is a flat scalar on purpose: OpenClaw's front-matter parser
 * supports **single-line keys only**, and the shared `installAssetFile` helper
 * serialises metadata with `yaml.stringify`, which emits multi-line YAML for
 * nested objects. A nested value would therefore produce front-matter OpenClaw
 * cannot parse, so `buildAssetMetadata` rejects any non-scalar value (see
 * `assertFlatMetadata`).
 *
 * The nested `metadata.openclaw` gating block is intentionally NOT modelled in
 * v1 for the same reason — it would have to be emitted as single-line JSON,
 * which the shared YAML serialiser does not do.
 */
const OpenClawMetadataSchema = type({
  'name?': 'string',
  'description?': 'string',
  // Slash-command controls (AgentSkills / OpenClaw front-matter)
  'user-invocable?': 'boolean',
  'disable-model-invocation?': 'boolean',
  'command-dispatch?': '"tool"',
  'command-tool?': 'string',
  'command-arg-mode?': '"raw"',
  // Presentation / platform gating
  'homepage?': 'string',
  'os?': '"darwin" | "linux" | "win32"',
})

/**
 * OpenClaw adapter — defines the conventions for OpenClaw
 * (https://github.com/openclaw/openclaw), a personal AI assistant that runs the
 * Pi agent runtime and is driven entirely by **skills**.
 *
 * ## Directory layout
 *
 *   Skills   (project) → <cwd>/.agents/skills/<name>/SKILL.md
 *   Skills   (user)    → ~/.agents/skills/<name>/SKILL.md
 *   Commands (project) → <cwd>/.agents/skills/<name>/SKILL.md   (user-invocable)
 *   Commands (user)    → ~/.agents/skills/<name>/SKILL.md       (user-invocable)
 *   Agents   (project) → <cwd>/.agents/skills/<name>/SKILL.md
 *   Agents   (user)    → ~/.agents/skills/<name>/SKILL.md
 *
 * Unlike the codex / claude-code / opencode adapters, OpenClaw has no separate
 * on-disk convention for agents or commands:
 *
 *   - **Commands** are slash commands *derived from a skill* whose front-matter
 *     sets `user-invocable: true`. There is no `commands/` directory to load.
 *   - **Agents** are entries in the `agents.list[]` array inside the shared
 *     `~/.openclaw/openclaw.json` config — not one file per agent.
 *
 * OpenClaw's only file-based asset surface is the skill (`SKILL.md`), and it
 * discovers skills under the `.agents/skills` roots (the same cross-tool
 * `.agents/` convention the codex adapter writes to). This adapter therefore
 * maps all three facet asset types onto `SKILL.md` files, differing only by the
 * front-matter defaults applied per asset type:
 *
 *   - `command` → defaults `user-invocable: true` + `disable-model-invocation:
 *     true` (a pure slash command, kept out of the model prompt) unless the
 *     facet overrides them.
 *   - `agent`   → installed as a skill verbatim (OpenClaw has no agent file
 *     convention; a facet "agent" surfaces as an OpenClaw skill).
 *   - `skill`   → installed verbatim.
 *
 * The body is stored verbatim after the YAML front-matter, matching the shared
 * helper used by every other first-party adapter.
 */
export default defineAdapter({
  name: 'openclaw',
  supportsInstall: true,

  buildAssetMetadata(data) {
    const flatError = assertFlatMetadata(data)
    if (flatError) {
      return { ok: false, errors: [flatError] }
    }

    const result = OpenClawMetadataSchema(data)

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
    const file = resolvePath(scope, name)
    const effective = withAssetDefaults(assetType, metadata as Record<string, unknown> | undefined)
    await installAssetFile({ file }, content, effective)
  },

  async readAsset(scope, _assetType, name) {
    return readAssetFile({ file: resolvePath(scope, name) })
  },

  async deleteAsset(scope, _assetType, name) {
    await deleteAssetFile({ file: resolvePath(scope, name) })
  },
})

// --- metadata helpers ---

/**
 * Reject any non-scalar metadata value. OpenClaw's front-matter parser is
 * single-line-only, so a nested object/array would serialise to multi-line YAML
 * the parser cannot read. Returns a structured `ValidationError` for the first
 * offending key, or `undefined` when the input is flat (or not an object — in
 * which case the arktype schema handles the type error).
 */
function assertFlatMetadata(data: unknown): ValidationError | undefined {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }

  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object') {
      return {
        path: key,
        message:
          'OpenClaw front-matter supports single-line scalar keys only; nested objects and arrays are not allowed',
        expected: 'string | number | boolean',
        actual: Array.isArray(value) ? 'array' : 'object',
      }
    }
  }

  return undefined
}

/**
 * Apply per-asset-type front-matter defaults. A facet `command` becomes a
 * user-invocable, model-hidden slash command; `skill` and `agent` pass through
 * unchanged. Caller-supplied metadata always wins on key collision.
 */
function withAssetDefaults(
  assetType: AssetType,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (assetType === 'command') {
    return { 'user-invocable': true, 'disable-model-invocation': true, ...(metadata ?? {}) }
  }
  return metadata ?? {}
}

// --- path resolution ---

/**
 * Resolve the absolute `SKILL.md` path for an asset under OpenClaw's `.agents`
 * skill roots. `<name>` may contain forward slashes for facet-namespacing
 * (e.g. `viper-plans/planning` → `skills/viper-plans/planning/SKILL.md`).
 */
function resolvePath(scope: Scope, name: string): string {
  return join(baseDirFor(scope), 'skills', name, 'SKILL.md')
}

function baseDirFor(scope: Scope): string {
  switch (scope) {
    case 'user': {
      const home = process.env.HOME ?? homedir()
      return join(home, '.agents')
    }
    case 'project':
      return join(process.cwd(), '.agents')
    case 'system':
      throw new Error('openclaw adapter: system scope is not supported')
  }
}
