import { join } from 'node:path'
import { FACET_MANIFEST_FILE } from '@agent-facets/protocol'
import { applyFsTransaction, type FsMutation } from '../fs-transaction.ts'
import { jsonFileText } from '../json-file-text.ts'
import { README_MD } from '../readme.ts'

// --- Types ---

/**
 * README scaffolding intent, narrowed from the create UI / headless flags. The
 * enabled arm carries the exact content to write verbatim (seeded or authored);
 * the engine never regenerates it. Disabled writes no README file or
 * declaration. Tagged so an "enabled but no content" or "disabled but has
 * content" state is unrepresentable.
 */
export type ScaffoldReadme = { kind: 'enabled'; content: string } | { kind: 'disabled' }

export interface ScaffoldOptions {
  name: string
  version: string
  description: string
  // Privacy publish intent. True-only by design: public visibility is
  // represented by omitting this option (and omitting `private` from the
  // generated manifest), never by passing `false`. This mirrors the manifest
  // serialization contract where omission is public-by-default, so callers
  // cannot pass a meaningful `false` the engine would have to discard.
  private?: true
  skills: string[]
  agents: string[]
  commands: string[]
  // README scaffolding intent. Required and tagged: callers decide the
  // default-on policy (interactive/headless create) and hand the engine an
  // explicit enabled/disabled decision.
  readme: ScaffoldReadme
}

// --- Defaults ---

export const DEFAULT_VERSION = '0.0.0'

// --- Validation ---

// Asset-name validation lives in `@agent-facets/protocol`
// (`validateAssetNameSegment`). Callers import it directly rather than through
// engine, since engine must not re-export protocol.
export const SEMVER = /^\d+\.\d+\.\d+$/

export function isValidSemVer(value: string): boolean {
  return SEMVER.test(value)
}

// --- Template generation ---

function toTitleCase(kebab: string): string {
  return kebab
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function skillTemplate(name: string): string {
  return `# ${toTitleCase(name)}

<!-- This is a starter skill template. Replace this content with your skill's instructions. -->
<!-- Skills provide reusable knowledge and guidelines that agents and commands can reference. -->
<!-- A skill needs a description (required) — the description helps consumers decide -->
<!-- whether to use this skill. The prompt content is this file. -->

## Purpose

Describe what this skill teaches or what guidelines it provides.

## Guidelines

- Add your skill's guidelines here
- Each guideline should be clear and actionable
`
}

export function agentTemplate(name: string): string {
  return `# ${toTitleCase(name)}

<!-- This is a starter agent template. Replace this content with your agent's prompt. -->
<!-- Agents are AI assistant personas with specific roles, behaviors, and tool access. -->

## Role

Describe this agent's role and responsibilities.

## Behavior

- Define how this agent should behave
- Specify what tools it should use
- Describe its communication style
`
}

export function commandTemplate(name: string): string {
  return `# ${toTitleCase(name)}

<!-- This is a starter command template. Replace this content with your command's prompt. -->
<!-- Commands are user-invokable actions that perform specific tasks. -->

## Task

Describe what this command does when invoked.

## Steps

1. First step
2. Second step
3. Final step
`
}

// --- Manifest generation ---

export function generateScaffoldManifest(opts: ScaffoldOptions): string {
  const manifest: Record<string, unknown> = {
    name: opts.name,
    version: opts.version,
  }

  if (opts.description) {
    manifest.description = opts.description
  }

  // Placed after name/version/description and before asset sections to match
  // manifest field order. Written only when private; public omits the key.
  if (opts.private) {
    manifest.private = true
  }

  if (opts.skills.length > 0) {
    const skills: Record<string, { description: string }> = {}
    for (const skill of opts.skills) {
      skills[skill] = { description: `A ${toTitleCase(skill)} skill` }
    }
    manifest.skills = skills
  }

  if (opts.agents.length > 0) {
    const agents: Record<string, { description: string }> = {}
    for (const agent of opts.agents) {
      agents[agent] = { description: `A ${toTitleCase(agent)} agent` }
    }
    manifest.agents = agents
  }

  if (opts.commands.length > 0) {
    const commands: Record<string, { description: string }> = {}
    for (const command of opts.commands) {
      commands[command] = { description: `A ${toTitleCase(command)} command` }
    }
    manifest.commands = commands
  }

  // README is an ordinary top-level supplementary declaration — no
  // README-specific manifest field. Declared last, after asset sections.
  if (opts.readme.kind === 'enabled') {
    manifest.files = [README_MD]
  }

  return jsonFileText(manifest)
}

// --- File listing preview ---

export function previewScaffoldFiles(opts: ScaffoldOptions): string[] {
  const files: string[] = [FACET_MANIFEST_FILE]
  if (opts.readme.kind === 'enabled') {
    files.push(README_MD)
  }
  for (const skill of opts.skills) {
    files.push(`skills/${skill}/SKILL.md`)
  }
  for (const agent of opts.agents) {
    files.push(`agents/${agent}.md`)
  }
  for (const command of opts.commands) {
    files.push(`commands/${command}.md`)
  }
  return files
}

// --- Scaffold writing ---

/**
 * Derive the exact, ordered set of file mutations for a scaffold. Kept pure so
 * both `writeScaffold` and its tests can inspect the planned bytes without
 * touching disk. Order matches `previewScaffoldFiles`.
 */
function scaffoldMutations(opts: ScaffoldOptions, targetDir: string): FsMutation[] {
  const encoder = new TextEncoder()
  const mutations: FsMutation[] = [
    {
      kind: 'write',
      path: join(targetDir, FACET_MANIFEST_FILE),
      bytes: encoder.encode(generateScaffoldManifest(opts)),
    },
  ]
  if (opts.readme.kind === 'enabled') {
    mutations.push({ kind: 'write', path: join(targetDir, README_MD), bytes: encoder.encode(opts.readme.content) })
  }
  // Agent Skills directory convention: skills/<name>/SKILL.md
  for (const skill of opts.skills) {
    mutations.push({
      kind: 'write',
      path: join(targetDir, `skills/${skill}/SKILL.md`),
      bytes: encoder.encode(skillTemplate(skill)),
    })
  }
  for (const agent of opts.agents) {
    mutations.push({
      kind: 'write',
      path: join(targetDir, `agents/${agent}.md`),
      bytes: encoder.encode(agentTemplate(agent)),
    })
  }
  for (const command of opts.commands) {
    mutations.push({
      kind: 'write',
      path: join(targetDir, `commands/${command}.md`),
      bytes: encoder.encode(commandTemplate(command)),
    })
  }
  return mutations
}

/**
 * Write a scaffold as one atomic transaction: `facet.json`, README (when
 * enabled), and every starter asset commit together, or the target directory is
 * left as it was. Returns the list of relative paths written on success.
 *
 * A transaction failure here is an environment-level filesystem error with no
 * caller recovery path (create has nowhere to fall back to), so it is thrown
 * after rollback rather than returned. The transaction primitive itself is
 * result-shaped for the edit apply path, which can recover.
 */
export async function writeScaffold(opts: ScaffoldOptions, targetDir: string): Promise<string[]> {
  const result = applyFsTransaction(scaffoldMutations(opts, targetDir))
  if (!result.ok) {
    throw new Error(
      `scaffold write failed at ${result.failedPath}: ${result.reason}` +
        (result.rollback.ok ? '' : ` (rollback incomplete: ${result.rollback.failedPaths.join(', ')})`),
    )
  }
  return previewScaffoldFiles(opts)
}
