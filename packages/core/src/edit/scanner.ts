import { Glob } from 'bun'

/** Kebab-case pattern for valid asset names. */
export const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export type AssetType = 'skills' | 'agents' | 'commands'

export interface DiscoveredAsset {
  type: AssetType
  name: string
  /** Relative path from the facet root (e.g., 'skills/review/SKILL.md') */
  path: string
}

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
  const skillGlob = new Glob('skills/*/SKILL.md')
  for await (const match of skillGlob.scan({ cwd: rootDir, onlyFiles: true })) {
    // match is e.g. 'skills/review/SKILL.md'
    const parts = match.split('/')
    const name = parts[1]
    if (name && KEBAB_CASE.test(name)) {
      assets.push({ type: 'skills', name, path: match })
    }
  }

  // Scan agents: agents/*.md
  const agentGlob = new Glob('agents/*.md')
  for await (const match of agentGlob.scan({ cwd: rootDir, onlyFiles: true })) {
    const name = match.replace('agents/', '').replace('.md', '')
    if (KEBAB_CASE.test(name)) {
      assets.push({ type: 'agents', name, path: match })
    }
  }

  // Scan commands: commands/*.md
  const commandGlob = new Glob('commands/*.md')
  for await (const match of commandGlob.scan({ cwd: rootDir, onlyFiles: true })) {
    const name = match.replace('commands/', '').replace('.md', '')
    if (KEBAB_CASE.test(name)) {
      assets.push({ type: 'commands', name, path: match })
    }
  }

  return assets.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
}
