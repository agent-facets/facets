import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FACET_MANIFEST_FILE } from '@agent-facets/protocol'
import { jsonFileText } from '../json-file-text.ts'

// --- Types ---

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

  return jsonFileText(manifest)
}

// --- File listing preview ---

export function previewScaffoldFiles(opts: ScaffoldOptions): string[] {
  const files: string[] = [FACET_MANIFEST_FILE]
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

export async function writeScaffold(opts: ScaffoldOptions, targetDir: string): Promise<string[]> {
  const files: string[] = []

  // Write manifest
  const manifestPath = join(targetDir, FACET_MANIFEST_FILE)
  await Bun.write(manifestPath, generateScaffoldManifest(opts))
  files.push(FACET_MANIFEST_FILE)

  // Write skill files (Agent Skills directory convention: skills/<name>/SKILL.md)
  for (const skill of opts.skills) {
    await mkdir(join(targetDir, 'skills', skill), { recursive: true })
    await Bun.write(join(targetDir, `skills/${skill}/SKILL.md`), skillTemplate(skill))
    files.push(`skills/${skill}/SKILL.md`)
  }

  // Write agent files
  for (const agent of opts.agents) {
    await mkdir(join(targetDir, 'agents'), { recursive: true })
    await Bun.write(join(targetDir, `agents/${agent}.md`), agentTemplate(agent))
    files.push(`agents/${agent}.md`)
  }

  // Write command files
  for (const command of opts.commands) {
    await mkdir(join(targetDir, 'commands'), { recursive: true })
    await Bun.write(join(targetDir, `commands/${command}.md`), commandTemplate(command))
    files.push(`commands/${command}.md`)
  }

  return files
}
