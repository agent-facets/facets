import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import dedent from 'dedent'
import { parseTar, parseTarGzip } from 'nanotar'
import { computeContentHash } from '../build/content-hash.ts'
import { detectNamingCollisions } from '../build/detect-collisions.ts'
import { runBuildPipeline } from '../build/pipeline.ts'
import { validateCompactFacets } from '../build/validate-facets.ts'
import { validatePlatformConfigs } from '../build/validate-platforms.ts'
import { writeBuildOutput } from '../build/write-output.ts'
import type { FacetManifest } from '../schemas/facet-manifest.ts'

let testDir: string

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'build-pipeline-test-'))
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

async function createFixtureDir(name: string): Promise<string> {
  const dir = join(testDir, name)
  await Bun.write(join(dir, '.keep'), '')
  return dir
}

// --- Compact facets validation ---

describe('validateCompactFacets', () => {
  test('valid compact entry passes', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      facets: ['base@1.0.0'],
    } as FacetManifest
    const errors = validateCompactFacets(manifest)
    expect(errors).toHaveLength(0)
  })

  test('scoped compact entry passes', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      facets: ['@acme/base@2.0.0'],
    } as FacetManifest
    const errors = validateCompactFacets(manifest)
    expect(errors).toHaveLength(0)
  })

  test('malformed compact entry fails', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      facets: ['no-version-here'],
    } as FacetManifest
    const errors = validateCompactFacets(manifest)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.path).toBe('facets[0]')
    expect(errors[0]?.message).toContain('name@version')
  })

  test('selective entries are skipped', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      facets: [{ name: 'other', version: '1.0.0', skills: ['x'] }],
    } as FacetManifest
    const errors = validateCompactFacets(manifest)
    expect(errors).toHaveLength(0)
  })

  test('no facets section passes', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { x: { description: 'A skill' } },
    } as FacetManifest
    const errors = validateCompactFacets(manifest)
    expect(errors).toHaveLength(0)
  })
})

// --- Naming collision detection ---

describe('detectNamingCollisions', () => {
  test('no collisions with distinct names', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { review: { description: 'Review skill' } },
      agents: { helper: { description: 'Helper agent' } },
      commands: { deploy: { description: 'Deploy command' } },
    } as FacetManifest
    const errors = detectNamingCollisions(manifest)
    expect(errors).toHaveLength(0)
  })

  test('skill and command sharing a name is allowed (cross-type)', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { review: { description: 'Review skill' } },
      commands: { review: { description: 'Run review' } },
    } as FacetManifest
    const errors = detectNamingCollisions(manifest)
    expect(errors).toHaveLength(0)
  })

  test('agent and skill sharing a name is allowed (cross-type)', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { helper: { description: 'Helper skill' } },
      agents: { helper: { description: 'Helper agent' } },
    } as FacetManifest
    const errors = detectNamingCollisions(manifest)
    expect(errors).toHaveLength(0)
  })

  test('same name across all three types is allowed (cross-type)', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { deploy: { description: 'Deploy skill' } },
      agents: { deploy: { description: 'Deploy agent' } },
      commands: { deploy: { description: 'Deploy command' } },
    } as FacetManifest
    const errors = detectNamingCollisions(manifest)
    expect(errors).toHaveLength(0)
  })
})

// --- Platform config validation ---

describe('validatePlatformConfigs', () => {
  test('valid opencode config passes', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      agents: {
        reviewer: {
          description: 'Reviewer agent',
          platforms: {
            opencode: { tools: { grep: true, bash: true } },
          },
        },
      },
    } as FacetManifest
    const result = validatePlatformConfigs(manifest)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  test('unknown platform produces warning', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: {
        review: {
          description: 'Review skill',
          platforms: {
            'unknown-platform': { foo: 'bar' },
          },
        },
      },
    } as FacetManifest
    const result = validatePlatformConfigs(manifest)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('unknown-platform')
  })

  test('invalid opencode config fails', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      agents: {
        reviewer: {
          description: 'Reviewer agent',
          platforms: {
            opencode: { tools: 'not-a-record' },
          },
        },
      },
    } as FacetManifest
    const result = validatePlatformConfigs(manifest)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]?.message).toContain('opencode')
  })

  test('no platforms on any asset passes', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { x: { description: 'A skill' } },
    } as FacetManifest
    const result = validatePlatformConfigs(manifest)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })
})

// --- Build pipeline (end-to-end) ---

describe('runBuildPipeline', () => {
  test('successful build with valid facet', async () => {
    const dir = await createFixtureDir('valid-build')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          example: {
            description: 'An example skill',
          },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('test-facet')
      expect(result.data.skills?.example?.prompt).toBe('# Example skill')

      // Content hashing fields
      expect(result.archiveFilename).toBe('test-facet-1.0.0.facet')
      expect(result.archiveBytes.length).toBeGreaterThan(0)
      expect(Object.keys(result.assetHashes)).toContain('facet.json')
      expect(Object.keys(result.assetHashes)).toContain('skills/example/SKILL.md')
      expect(result.assetHashes['skills/example/SKILL.md']).toMatchInlineSnapshot(
        `"sha256:ded8057927e03783371d0d929e4a6e92da66eb9dd164377ad6845a5a1c0cb5ba"`,
      )
      expect(result.integrity).toMatch(/^sha256:[a-f0-9]{64}$/)
    }
  })

  test('build fails on missing manifest', async () => {
    const dir = await createFixtureDir('no-manifest')
    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(false)
  })

  test('build fails on missing asset file', async () => {
    const dir = await createFixtureDir('missing-file')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          example: {
            description: 'An example skill',
          },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.path).toBe('skills.example')
      expect(result.errors[0]?.message).toContain('skills/example/SKILL.md')
    }
  })

  test('build succeeds with cross-type name sharing', async () => {
    const dir = await createFixtureDir('cross-type')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# Review skill')
    await Bun.write(join(dir, 'commands/review.md'), '# Review command')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          review: { description: 'A review skill' },
        },
        commands: {
          review: { description: 'A review command' },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(true)
  })

  test('build with all asset types includes all hashes', async () => {
    const dir = await createFixtureDir('all-types')
    await Bun.write(join(dir, 'skills/alpha/SKILL.md'), '# Alpha skill')
    await Bun.write(join(dir, 'skills/beta/SKILL.md'), '# Beta skill')
    await Bun.write(join(dir, 'agents/helper.md'), '# Helper agent')
    await Bun.write(join(dir, 'commands/deploy.md'), '# Deploy command')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'multi-facet',
        version: '2.0.0',
        skills: {
          alpha: { description: 'Alpha skill' },
          beta: { description: 'Beta skill' },
        },
        agents: {
          helper: { description: 'Helper agent' },
        },
        commands: {
          deploy: { description: 'Deploy command' },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.archiveFilename).toBe('multi-facet-2.0.0.facet')
      const assetPaths = Object.keys(result.assetHashes).sort()
      expect(assetPaths).toEqual([
        'agents/helper.md',
        'commands/deploy.md',
        'facet.json',
        'skills/alpha/SKILL.md',
        'skills/beta/SKILL.md',
      ])
    }
  })

  test('build fails on malformed compact facets entry', async () => {
    const dir = await createFixtureDir('bad-facets')
    await Bun.write(join(dir, 'skills/x/SKILL.md'), '# Skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          x: { description: 'A skill' },
        },
        facets: ['no-version-here'],
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain('name@version')
    }
  })
})

// --- Content validation ---

describe('content validation', () => {
  test('build fails on file with YAML front matter', async () => {
    const dir = await createFixtureDir('front-matter')
    await Bun.write(
      join(dir, 'skills/review/SKILL.md'),
      dedent`
        ---
        name: Review
        description: A review skill
        ---
        # Review
        Review all code.
      `,
    )
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          review: { description: 'A review skill' },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.path).toBe('skills.review')
      expect(result.errors[0]?.message).toContain('front matter')
      expect(result.errors[0]?.message).toContain('skills/review/SKILL.md')
    }
  })

  test('build fails on empty content file', async () => {
    const dir = await createFixtureDir('empty-file')
    await Bun.write(join(dir, 'skills/empty/SKILL.md'), '')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          empty: { description: 'An empty skill' },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.path).toBe('skills.empty')
      expect(result.errors[0]?.message).toContain('empty')
    }
  })

  test('build fails on whitespace-only content file', async () => {
    const dir = await createFixtureDir('whitespace-file')
    await Bun.write(join(dir, 'agents/blank.md'), '   \n\n  \n')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        agents: {
          blank: { description: 'A blank agent' },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.path).toBe('agents.blank')
      expect(result.errors[0]?.message).toContain('empty')
    }
  })
})

// --- Build output generation ---

describe('writeBuildOutput', () => {
  test('writes self-contained .facet archive with embedded manifest', async () => {
    const dir = await createFixtureDir('write-output')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Resolved content')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          example: { description: 'A skill' },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await writeBuildOutput(result, dir)

    // .facet file exists
    const archivePath = join(dir, 'dist/test-facet-1.0.0.facet')
    const archiveExists = await Bun.file(archivePath).exists()
    expect(archiveExists).toBe(true)

    // dist/ contains exactly one file (no loose manifest)
    const distFiles = await readdir(join(dir, 'dist'))
    expect(distFiles).toEqual(['test-facet-1.0.0.facet'])

    // Outer tar contains exactly two entries: build-manifest.json and archive.tar.gz
    const outerBytes = await Bun.file(archivePath).arrayBuffer()
    const outerEntries = parseTar(outerBytes)
    const outerNames = outerEntries.map((e) => e.name).sort()
    expect(outerNames).toEqual(['archive.tar.gz', 'build-manifest.json'])

    // Embedded manifest has correct structure
    const manifestEntry = outerEntries.find((e) => e.name === 'build-manifest.json')
    if (!manifestEntry) throw new Error('build-manifest.json not found in outer tar')
    const manifest = JSON.parse(manifestEntry.text)
    expect(manifest.facetVersion).toBe(0.1)
    expect(manifest.archive).toBe('archive.tar.gz')
    expect(manifest.integrity).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(manifest.assets['facet.json']).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(manifest.assets['skills/example/SKILL.md']).toMatch(/^sha256:[a-f0-9]{64}$/)

    // Inner archive contains expected assets
    const innerEntry = outerEntries.find((e) => e.name === 'archive.tar.gz')
    if (!innerEntry?.data) throw new Error('archive.tar.gz not found in outer tar')
    const innerFiles = await parseTarGzip(innerEntry.data)
    const innerNames = innerFiles.map((f) => f.name).sort()
    expect(innerNames).toEqual(['facet.json', 'skills/example/SKILL.md'])

    // No loose files in dist/
    const looseManifest = await Bun.file(join(dir, 'dist/facet.json')).exists()
    expect(looseManifest).toBe(false)
  })

  test('integrity hash matches inner archive bytes', async () => {
    const dir = await createFixtureDir('integrity-check')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Skill content')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'hash-test',
        version: '1.0.0',
        skills: {
          example: { description: 'A skill' },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await writeBuildOutput(result, dir)

    // Extract manifest and inner archive from outer tar
    const outerBytes = await Bun.file(join(dir, 'dist/hash-test-1.0.0.facet')).arrayBuffer()
    const outerEntries = parseTar(outerBytes)
    const manifestEntry = outerEntries.find((e) => e.name === 'build-manifest.json')
    if (!manifestEntry) throw new Error('build-manifest.json not found in outer tar')
    const manifest = JSON.parse(manifestEntry.text)
    const innerEntry = outerEntries.find((e) => e.name === 'archive.tar.gz')
    if (!innerEntry?.data) throw new Error('archive.tar.gz not found in outer tar')

    // Decompress inner archive and hash the raw tar bytes
    const innerGzBuffer = new Uint8Array(innerEntry.data).buffer
    const innerTarBytes = Bun.gunzipSync(innerGzBuffer)
    const computedHash = computeContentHash(innerTarBytes)

    expect(computedHash).toBe(manifest.integrity)
  })

  test('--emit-manifest writes loose build-manifest.json', async () => {
    const dir = await createFixtureDir('emit-manifest')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'emit-test',
        version: '1.0.0',
        skills: {
          example: { description: 'A skill' },
        },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await writeBuildOutput(result, dir, { emitManifest: true })

    // dist/ contains both files
    const distFiles = (await readdir(join(dir, 'dist'))).sort()
    expect(distFiles).toEqual(['build-manifest.json', 'emit-test-1.0.0.facet'])

    // Loose manifest matches embedded manifest
    const looseText = await Bun.file(join(dir, 'dist/build-manifest.json')).text()
    const outerBytes = await Bun.file(join(dir, 'dist/emit-test-1.0.0.facet')).arrayBuffer()
    const outerEntries = parseTar(outerBytes)
    const embeddedEntry = outerEntries.find((e) => e.name === 'build-manifest.json')
    if (!embeddedEntry) throw new Error('build-manifest.json not found in outer tar')
    expect(looseText).toBe(embeddedEntry.text)
  })

  test('cleans previous dist/ before writing', async () => {
    const dir = await createFixtureDir('clean-dist')
    await Bun.write(join(dir, 'skills/x/SKILL.md'), '# Skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        skills: {
          x: { description: 'A skill' },
        },
      }),
    )
    // Write a stale file in dist/
    await Bun.write(join(dir, 'dist/stale.txt'), 'stale')

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await writeBuildOutput(result, dir)

    // Stale file should be gone
    const staleExists = await Bun.file(join(dir, 'dist/stale.txt')).exists()
    expect(staleExists).toBe(false)

    // Only the .facet archive should exist (no loose manifest by default)
    const distFiles = await readdir(join(dir, 'dist'))
    expect(distFiles).toEqual(['test-1.0.0.facet'])
  })
})
