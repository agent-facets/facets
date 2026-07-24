import type { AssetType } from '@agent-facets/common'
import { validateAssetNameSegment } from '@agent-facets/protocol'
import { isReadmePath } from '../readme.ts'

/**
 * Plural manifest key derived from the canonical singular AssetType.
 * Used as the key in manifest sections and discovered asset types.
 */
export type AssetManifestKey = `${AssetType}s`

export interface DiscoveredAsset {
  type: AssetManifestKey
  name: string
  /** Relative path from the facet root (e.g., 'skills/review/SKILL.md') */
  path: string
}

/**
 * Common root-level supplementary files the edit scanner offers to adopt when
 * present but undeclared. Deliberately a small curated set — arbitrary stray
 * files are not surfaced (design D11 "SHOULD detect other common root files").
 * README paths are excluded here and routed to the dedicated README panel.
 */
export const COMMON_ROOT_FILES: readonly string[] = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'DEVELOPMENT.md',
] as const

/**
 * Scans a facet directory for content files and returns discovered assets.
 *
 * Skills use the directory convention: `skills/<name>/SKILL.md`
 * Agents use the flat convention: `agents/<name>.md`
 * Commands use the flat convention: `commands/<name>.md`
 *
 * Only assets with valid kebab-case names are returned.
 */
export async function scanAssets(rootDir: string): Promise<DiscoveredAsset[]> {
  const assets: DiscoveredAsset[] = []

  // Scan skills: skills/*/SKILL.md
  const skillGlob = new Bun.Glob('skills/*/SKILL.md')
  for await (const match of skillGlob.scan({ cwd: rootDir, onlyFiles: true })) {
    // match is e.g. 'skills/review/SKILL.md'
    const parts = match.split('/')
    const name = parts[1]
    if (name && validateAssetNameSegment(name).ok) {
      assets.push({ type: 'skills', name, path: match })
    }
  }

  // Scan agents: agents/*.md
  const agentGlob = new Bun.Glob('agents/*.md')
  for await (const match of agentGlob.scan({ cwd: rootDir, onlyFiles: true })) {
    const name = match.replace('agents/', '').replace('.md', '')
    if (validateAssetNameSegment(name).ok) {
      assets.push({ type: 'agents', name, path: match })
    }
  }

  // Scan commands: commands/*.md
  const commandGlob = new Bun.Glob('commands/*.md')
  for await (const match of commandGlob.scan({ cwd: rootDir, onlyFiles: true })) {
    const name = match.replace('commands/', '').replace('.md', '')
    if (validateAssetNameSegment(name).ok) {
      assets.push({ type: 'commands', name, path: match })
    }
  }

  return assets.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
}

/**
 * Scan all regular files beneath a declared skill's directory, excluding the
 * primary `SKILL.md`, and return their paths relative to the skill directory
 * (e.g. `references/api.md`). Used to detect undeclared companions and to
 * confirm declared companions exist on disk.
 */
export async function scanSkillCompanions(rootDir: string, skill: string): Promise<string[]> {
  const glob = new Bun.Glob(`skills/${skill}/**/*`)
  const rels: string[] = []
  const prefix = `skills/${skill}/`
  for await (const match of glob.scan({ cwd: rootDir, onlyFiles: true })) {
    if (!match.startsWith(prefix)) continue
    const rel = match.slice(prefix.length)
    if (rel === 'SKILL.md') continue
    rels.push(rel)
  }
  return rels.sort()
}

/**
 * Return the subset of `COMMON_ROOT_FILES` present as regular files at the
 * project root. README paths are never included.
 */
export async function scanCommonRootFiles(rootDir: string): Promise<string[]> {
  const present: string[] = []
  for (const name of COMMON_ROOT_FILES) {
    if (isReadmePath(name)) continue
    if (await Bun.file(`${rootDir}/${name}`).exists()) present.push(name)
  }
  return present
}
