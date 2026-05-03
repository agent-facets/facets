import { describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FacetManifest } from '@agent-facets/protocol'
import { writeManifest } from '../edit/manifest-writer.ts'
import { reconcile } from '../edit/reconcile.ts'
import type { DiscoveredAsset } from '../edit/scanner.ts'
import { scanAssets } from '../edit/scanner.ts'

async function createFixtureDir(name: string): Promise<string> {
  const dir = join(tmpdir(), `facets-edit-test-${name}-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  return dir
}

// --- Scanner ---

describe('scanAssets', () => {
  test('discovers skills in directory convention', async () => {
    const dir = await createFixtureDir('scan-skills')
    await mkdir(join(dir, 'skills/review'), { recursive: true })
    await mkdir(join(dir, 'skills/code-fix'), { recursive: true })
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# Review')
    await Bun.write(join(dir, 'skills/code-fix/SKILL.md'), '# Code Fix')

    const assets = await scanAssets(dir)
    expect(assets.filter((a) => a.type === 'skills')).toHaveLength(2)
    expect(assets.find((a) => a.name === 'review')).toBeDefined()
    expect(assets.find((a) => a.name === 'code-fix')).toBeDefined()
  })

  test('discovers agents and commands in flat convention', async () => {
    const dir = await createFixtureDir('scan-flat')
    await mkdir(join(dir, 'agents'), { recursive: true })
    await mkdir(join(dir, 'commands'), { recursive: true })
    await Bun.write(join(dir, 'agents/reviewer.md'), '# Reviewer')
    await Bun.write(join(dir, 'commands/deploy.md'), '# Deploy')

    const assets = await scanAssets(dir)
    expect(assets.find((a) => a.type === 'agents' && a.name === 'reviewer')).toBeDefined()
    expect(assets.find((a) => a.type === 'commands' && a.name === 'deploy')).toBeDefined()
  })

  test('skips non-kebab-case names', async () => {
    const dir = await createFixtureDir('scan-skip')
    await mkdir(join(dir, 'skills/InvalidName'), { recursive: true })
    await mkdir(join(dir, 'agents'), { recursive: true })
    await Bun.write(join(dir, 'skills/InvalidName/SKILL.md'), '# Bad')
    await Bun.write(join(dir, 'agents/NOT_VALID.md'), '# Bad')

    const assets = await scanAssets(dir)
    expect(assets).toHaveLength(0)
  })

  test('returns empty for directory with no assets', async () => {
    const dir = await createFixtureDir('scan-empty')
    const assets = await scanAssets(dir)
    expect(assets).toHaveLength(0)
  })

  test('returns sorted results', async () => {
    const dir = await createFixtureDir('scan-sorted')
    await mkdir(join(dir, 'skills/zebra'), { recursive: true })
    await mkdir(join(dir, 'agents'), { recursive: true })
    await mkdir(join(dir, 'skills/alpha'), { recursive: true })
    await Bun.write(join(dir, 'skills/zebra/SKILL.md'), '# Z')
    await Bun.write(join(dir, 'skills/alpha/SKILL.md'), '# A')
    await Bun.write(join(dir, 'agents/beta.md'), '# B')

    const assets = await scanAssets(dir)
    const names = assets.map((a) => `${a.type}:${a.name}`)
    expect(names).toEqual(['agents:beta', 'skills:alpha', 'skills:zebra'])
  })
})

// --- Reconciliation ---

describe('reconcile', () => {
  test('identifies additions (on disk, not in manifest)', () => {
    const manifest: FacetManifest = {
      name: 'test',
      version: '1.0.0',
      skills: { review: { description: 'Review skill' } },
    }
    const discovered: DiscoveredAsset[] = [
      { type: 'skills', name: 'review', path: 'skills/review/SKILL.md' },
      { type: 'skills', name: 'new-skill', path: 'skills/new-skill/SKILL.md' },
      { type: 'agents', name: 'helper', path: 'agents/helper.md' },
    ]

    const result = reconcile(manifest, discovered)
    expect(result.additions).toHaveLength(2)
    expect(result.additions.find((a) => a.name === 'new-skill')).toBeDefined()
    expect(result.additions.find((a) => a.name === 'helper')).toBeDefined()
  })

  test('identifies missing files (in manifest, not on disk)', () => {
    const manifest: FacetManifest = {
      name: 'test',
      version: '1.0.0',
      skills: {
        review: { description: 'Review' },
        gone: { description: 'Gone' },
      },
    }
    const discovered: DiscoveredAsset[] = [{ type: 'skills', name: 'review', path: 'skills/review/SKILL.md' }]

    const result = reconcile(manifest, discovered)
    expect(result.missing).toHaveLength(1)
    expect(result.missing[0]?.name).toBe('gone')
    expect(result.missing[0]?.expectedPath).toBe('skills/gone/SKILL.md')
  })

  test('identifies matched assets', () => {
    const manifest: FacetManifest = {
      name: 'test',
      version: '1.0.0',
      agents: { reviewer: { description: 'Review agent' } },
    }
    const discovered: DiscoveredAsset[] = [{ type: 'agents', name: 'reviewer', path: 'agents/reviewer.md' }]

    const result = reconcile(manifest, discovered)
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]?.name).toBe('reviewer')
    expect(result.additions).toHaveLength(0)
    expect(result.missing).toHaveLength(0)
  })

  test('handles manifest with no assets', () => {
    const manifest: FacetManifest = {
      name: 'test',
      version: '1.0.0',
      facets: ['base@1.0.0'],
    }
    const discovered: DiscoveredAsset[] = [{ type: 'skills', name: 'extra', path: 'skills/extra/SKILL.md' }]

    const result = reconcile(manifest, discovered)
    expect(result.additions).toHaveLength(1)
    expect(result.missing).toHaveLength(0)
    expect(result.matched).toHaveLength(0)
  })

  test('missing agent has flat file expected path', () => {
    const manifest: FacetManifest = {
      name: 'test',
      version: '1.0.0',
      agents: { gone: { description: 'Gone' } },
    }

    const result = reconcile(manifest, [])
    expect(result.missing[0]?.expectedPath).toBe('agents/gone.md')
  })
})

// --- Manifest Writer ---

describe('writeManifest', () => {
  test('writes valid JSON to facet.json', async () => {
    const dir = await createFixtureDir('write-manifest')
    const manifest: FacetManifest = {
      name: 'test-facet',
      version: '1.0.0',
      skills: { review: { description: 'A review skill' } },
    }

    await writeManifest(manifest, dir)

    const content = await Bun.file(join(dir, 'facet.json')).text()
    const parsed = JSON.parse(content)
    expect(parsed.name).toBe('test-facet')
    expect(parsed.version).toBe('1.0.0')
    expect(parsed.skills.review.description).toBe('A review skill')
  })

  test('output is 2-space indented', async () => {
    const dir = await createFixtureDir('write-indent')
    const manifest: FacetManifest = {
      name: 'test',
      version: '1.0.0',
      skills: { x: { description: 'X' } },
    }

    await writeManifest(manifest, dir)

    const content = await Bun.file(join(dir, 'facet.json')).text()
    // 2-space indent means lines like '  "name": "test"'
    expect(content).toContain('  "name"')
  })
})
