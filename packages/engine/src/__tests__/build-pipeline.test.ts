import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION, type Adapter, defineAdapter } from '@agent-facets/adapter'
import type { FacetManifest } from '@agent-facets/protocol'
import { computeContentHash, detectNamingCollisions, validateCompactFacets } from '@agent-facets/protocol'
import dedent from 'dedent'
import { parseTar, parseTarGzip } from 'nanotar'
import { runBuildPipeline } from '../build/pipeline.ts'
import { validateAdapterMetadata } from '../build/validate-adapters.ts'
import { writeBuildOutput } from '../build/write-output.ts'

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

// --- Adapter metadata validation ---

/** A mock adapter that accepts any data as valid metadata */
const mockAdapter = defineAdapter({
  name: 'mock-adapter',
  buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
  async installAsset() {
    return { ok: true as const, primaryPath: '/dev/null' }
  },
  async readAsset() {
    return { ok: true as const, asset: { assetType: 'command' as const, content: 'Your asset sir...' } }
  },
  async deleteAsset() {
    return { ok: true as const, existed: false, deletedPaths: [] }
  },
})

/** A mock adapter that rejects all metadata */
const rejectingAdapter = defineAdapter({
  name: 'rejecting-adapter',
  buildAssetMetadata: () => ({
    ok: false,
    errors: [{ path: 'tools', message: 'Invalid tools config', expected: 'Record<string, boolean>', actual: 'string' }],
  }),
  async installAsset() {
    return { ok: true as const, primaryPath: '/dev/null' }
  },
  async readAsset() {
    return { ok: true as const, asset: { assetType: 'command' as const, content: 'Your asset sir...' } }
  },
  async deleteAsset() {
    return { ok: true as const, existed: false, deletedPaths: [] }
  },
})

describe('validateAdapterMetadata', () => {
  test('valid adapter metadata passes', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      agents: {
        reviewer: {
          description: 'Reviewer agent',
          adapters: {
            'mock-adapter': { tools: { grep: true, bash: true } },
          },
        },
      },
    } as FacetManifest
    const result = validateAdapterMetadata(manifest, [mockAdapter])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  test('unknown adapter produces warning', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: {
        review: {
          description: 'Review skill',
          adapters: {
            'unknown-adapter': { foo: 'bar' },
          },
        },
      },
    } as FacetManifest
    const result = validateAdapterMetadata(manifest, [])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('unknown-adapter')
  })

  test('invalid adapter metadata fails', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      agents: {
        reviewer: {
          description: 'Reviewer agent',
          adapters: {
            'rejecting-adapter': { tools: 'not-a-record' },
          },
        },
      },
    } as FacetManifest
    const result = validateAdapterMetadata(manifest, [rejectingAdapter])
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]?.message).toContain('rejecting-adapter')
  })

  test('no adapters on any asset passes', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { x: { description: 'A skill' } },
    } as FacetManifest
    const result = validateAdapterMetadata(manifest, [mockAdapter])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  test('valid command adapter metadata passes', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      commands: {
        deploy: {
          description: 'Deploy command',
          adapters: {
            'mock-adapter': { tools: { grep: true } },
          },
        },
      },
    } as FacetManifest
    const result = validateAdapterMetadata(manifest, [mockAdapter])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  test('invalid command adapter metadata fails', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      commands: {
        deploy: {
          description: 'Deploy command',
          adapters: {
            'rejecting-adapter': { tools: 'not-a-record' },
          },
        },
      },
    } as FacetManifest
    const result = validateAdapterMetadata(manifest, [rejectingAdapter])
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]?.path).toContain('commands.deploy')
  })

  test('unknown adapter on a command produces warning', () => {
    const manifest = {
      name: 'test',
      version: '1.0.0',
      commands: {
        deploy: {
          description: 'Deploy command',
          adapters: {
            'unknown-adapter': { foo: 'bar' },
          },
        },
      },
    } as FacetManifest
    const result = validateAdapterMetadata(manifest, [])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('unknown-adapter')
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
      expect(Object.keys(result.fileHashes)).toContain('facet.json')
      expect(Object.keys(result.fileHashes)).toContain('skills/example/SKILL.md')
      expect(result.fileHashes['skills/example/SKILL.md']).toMatchInlineSnapshot(
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
      if (result.kind !== 'validation') expect.unreachable()
      expect(result.errors[0]?.path).toBe('skills.example')
      expect(result.errors[0]?.message).toContain('skills/example/SKILL.md')
    }
  })

  // Skills and commands share one logical namespace in the current manifest
  // format (design D9); agents remain a separate namespace.
  test('build fails when a skill and command share a name', async () => {
    const dir = await createFixtureDir('cross-type-collision')
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
    expect(result.ok).toBe(false)
  })

  test('build succeeds when an agent shares a name with a skill', async () => {
    const dir = await createFixtureDir('cross-type-agent')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# Review skill')
    await Bun.write(join(dir, 'agents/review.md'), '# Review agent')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          review: { description: 'A review skill' },
        },
        agents: {
          review: { description: 'A review agent' },
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
      const assetPaths = Object.keys(result.fileHashes).sort()
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
      if (result.kind !== 'validation') expect.unreachable()
      expect(result.errors[0]?.message).toContain('name@version')
    }
  })

  // --- Adapter integration ---

  test('build with valid adapter metadata passes', async () => {
    const dir = await createFixtureDir('pipeline-valid-adapter')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          example: {
            description: 'An example skill',
            adapters: {
              'mock-adapter': { tools: { grep: true } },
            },
          },
        },
      }),
    )

    const mockAdapter = defineAdapter({
      name: 'mock-adapter',
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      async installAsset() {
        return { ok: true as const, primaryPath: '/dev/null' }
      },
      async readAsset() {
        return { ok: true as const, asset: { assetType: 'command' as const, content: 'Your asset sir...' } }
      },
      async deleteAsset() {
        return { ok: true as const, existed: false, deletedPaths: [] }
      },
    })

    const result = await runBuildPipeline(dir, [mockAdapter])
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  test('build with invalid adapter metadata fails', async () => {
    const dir = await createFixtureDir('pipeline-invalid-adapter')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          example: {
            description: 'An example skill',
            adapters: {
              'rejecting-adapter': { tools: 'not-a-record' },
            },
          },
        },
      }),
    )

    const rejectingAdapter = defineAdapter({
      name: 'rejecting-adapter',
      buildAssetMetadata: () => ({
        ok: false,
        errors: [
          {
            path: 'tools',
            message: 'Invalid tools config',
            expected: 'Record<string, boolean>',
            actual: 'string',
          },
        ],
      }),
      async installAsset() {
        return { ok: true as const, primaryPath: '/dev/null' }
      },
      async readAsset() {
        return { ok: true as const, asset: { assetType: 'command' as const, content: 'Your asset sir...' } }
      },
      async deleteAsset() {
        return { ok: true as const, existed: false, deletedPaths: [] }
      },
    })

    const result = await runBuildPipeline(dir, [rejectingAdapter])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      if (result.kind !== 'validation') expect.unreachable()
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.message.includes('rejecting-adapter'))).toBe(true)
    }
  })

  test('build with unknown adapter produces warning', async () => {
    const dir = await createFixtureDir('pipeline-unknown-adapter')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          example: {
            description: 'An example skill',
            adapters: {
              'unknown-adapter': { foo: 'bar' },
            },
          },
        },
      }),
    )

    // No adapters provided — unknown-adapter should produce a warning but not fail the build
    const result = await runBuildPipeline(dir, [])
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.includes('unknown-adapter'))).toBe(true)
  })

  test('adapter with default values enriches metadata through the pipeline', async () => {
    const dir = await createFixtureDir('pipeline-defaulting-adapter')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          example: {
            description: 'An example skill',
            // Input omits the "model" field — adapter should inject default
            adapters: {
              'defaulting-adapter': {},
            },
          },
        },
      }),
    )

    let enrichedData: Record<string, unknown> | undefined

    const defaultingAdapter = defineAdapter({
      name: 'defaulting-adapter',
      buildAssetMetadata: (data) => {
        const input = (data ?? {}) as { model?: string }
        // Adapter enriches metadata by injecting a default "model" field
        enrichedData = { model: input.model ?? 'auto' }
        return { ok: true, data: enrichedData }
      },
      async installAsset() {
        return { ok: true as const, primaryPath: '/dev/null' }
      },
      async readAsset() {
        return { ok: true as const, asset: { assetType: 'command' as const, content: 'Your asset sir...' } }
      },
      async deleteAsset() {
        return { ok: true as const, existed: false, deletedPaths: [] }
      },
    })

    const result = await runBuildPipeline(dir, [defaultingAdapter])
    expect(result.ok).toBe(true)
    // Verify the adapter's buildAssetMetadata was called and produced enriched output
    expect(enrichedData).toEqual({ model: 'auto' })
  })
})

// --- Content validation ---

describe('content validation', () => {
  test('build succeeds when content files contain YAML front matter; archive preserves the body verbatim', async () => {
    const dir = await createFixtureDir('front-matter')
    const authoredBody = dedent`
      ---
      name: Review
      description: A review skill
      agent: cowsay
      ---
      # Review
      Review all code.
    `
    await Bun.write(join(dir, 'skills/review/SKILL.md'), authoredBody)
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
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()

    // Build resolved the prompt verbatim — front matter survives untouched.
    expect(result.data.skills?.review?.prompt).toBe(authoredBody)

    // The asset hash is computed over the verbatim file contents, so the
    // entry exists in the archive's per-asset hash map.
    expect(result.fileHashes['skills/review/SKILL.md']).toMatch(/^sha256:/)
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
      if (result.kind !== 'validation') expect.unreachable()
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
      if (result.kind !== 'validation') expect.unreachable()
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
    if (!result.ok) expect.unreachable()
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
    // Producers now emit the current `0.2` flat build manifest with a
    // complete `files` map; `0.1`/`assets` is a legacy consumer input only.
    expect(manifest.facetVersion).toBe(0.2)
    expect(manifest.archive).toBe('archive.tar.gz')
    expect(manifest.integrity).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(manifest.assets).toBeUndefined()
    expect(manifest.files['facet.json']).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(manifest.files['skills/example/SKILL.md']).toMatch(/^sha256:[a-f0-9]{64}$/)

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
    if (!result.ok) expect.unreachable()
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
    if (!result.ok) expect.unreachable()
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

  test('writes a scoped facet to a nested dist/ path, creating parent dirs', async () => {
    const dir = await createFixtureDir('scoped-output')
    await Bun.write(join(dir, 'skills/cowsay/SKILL.md'), '# Cowsay')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: '@julian/cowsay',
        version: '1.0.0',
        skills: { cowsay: { description: 'Cowsay tools' } },
      }),
    )

    const result = await runBuildPipeline(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    // Without the parent-dir mkdir this rejects with ENOENT.
    await writeBuildOutput(result, dir)

    // The archive lands at the nested scoped path.
    const archivePath = join(dir, 'dist/@julian/cowsay-1.0.0.facet')
    expect(await Bun.file(archivePath).exists()).toBe(true)

    // The archive's embedded facet.json keeps the scoped identity; the inner
    // asset paths are still derived from asset names, not the facet identity.
    const outerBytes = await Bun.file(archivePath).arrayBuffer()
    const outerEntries = parseTar(outerBytes)
    const innerEntry = outerEntries.find((e) => e.name === 'archive.tar.gz')
    if (!innerEntry?.data) throw new Error('archive.tar.gz not found in outer tar')
    const innerFiles = await parseTarGzip(innerEntry.data)
    const facetJsonEntry = innerFiles.find((f) => f.name === 'facet.json')
    if (!facetJsonEntry) throw new Error('facet.json not found in inner archive')
    expect(JSON.parse(facetJsonEntry.text).name).toBe('@julian/cowsay')
    expect(innerFiles.map((f) => f.name).sort()).toEqual(['facet.json', 'skills/cowsay/SKILL.md'])
  })

  test('writeBuildOutput creates parent dirs for a slash-containing archive filename', async () => {
    // The build-output parent-dir fix is the load-bearing repair. A bare
    // slash-containing manifest name (`acme/cowsay`) no longer passes
    // FacetManifestSchema, so it can't reach here through runBuildPipeline —
    // but the write boundary itself must still create parent dirs for ANY
    // slash-containing archive filename (scoped names, plus defense-in-depth
    // for the pre-existing nested-path bug). We exercise the boundary
    // directly with a synthesized BuildResult.
    const dir = await createFixtureDir('slash-write-boundary')
    const realResult = await (async () => {
      await Bun.write(join(dir, 'skills/cowsay/SKILL.md'), '# Cowsay')
      await Bun.write(
        join(dir, 'facet.json'),
        JSON.stringify({
          name: '@acme/cowsay',
          version: '1.0.0',
          skills: { cowsay: { description: 'Cowsay tools' } },
        }),
      )
      const r = await runBuildPipeline(dir)
      if (!r.ok) expect.unreachable()
      return r
    })()
    // Re-point the archive filename at a bare slash-namespaced path to prove
    // the write boundary creates parents regardless of how the name renders.
    const slashResult = { ...realResult, archiveFilename: 'acme/cowsay-1.0.0.facet' }
    await writeBuildOutput(slashResult, dir)

    expect(await Bun.file(join(dir, 'dist/acme/cowsay-1.0.0.facet')).exists()).toBe(true)
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
    if (!result.ok) expect.unreachable()
    await writeBuildOutput(result, dir)

    // Stale file should be gone
    const staleExists = await Bun.file(join(dir, 'dist/stale.txt')).exists()
    expect(staleExists).toBe(false)

    // Only the .facet archive should exist (no loose manifest by default)
    const distFiles = await readdir(join(dir, 'dist'))
    expect(distFiles).toEqual(['test-1.0.0.facet'])
  })
})

// --- Embedded manifest privacy preservation ---

/**
 * Parse the embedded `facet.json` out of a build's outer-tar `archiveBytes`.
 * Mirrors the inner-archive read used by the scoped-identity test above.
 */
async function readEmbeddedManifest(archiveBytes: Uint8Array): Promise<Record<string, unknown>> {
  const outerEntries = parseTar(archiveBytes)
  const innerEntry = outerEntries.find((e) => e.name === 'archive.tar.gz')
  if (!innerEntry?.data) throw new Error('archive.tar.gz not found in outer tar')
  const innerFiles = await parseTarGzip(innerEntry.data)
  const facetJsonEntry = innerFiles.find((f) => f.name === 'facet.json')
  if (!facetJsonEntry) throw new Error('facet.json not found in inner archive')
  return JSON.parse(facetJsonEntry.text) as Record<string, unknown>
}

describe('runBuildPipeline — embedded manifest privacy', () => {
  test('build with private: true embeds private: true', async () => {
    const dir = await createFixtureDir('private-true')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'private-facet',
        version: '1.0.0',
        private: true,
        skills: { example: { description: 'An example skill' } },
      }),
    )

    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()
    const embedded = await readEmbeddedManifest(result.archiveBytes)
    expect(embedded.private).toBe(true)
  })

  test('build with private: false embeds private: false', async () => {
    const dir = await createFixtureDir('private-false')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'public-facet',
        version: '1.0.0',
        private: false,
        skills: { example: { description: 'An example skill' } },
      }),
    )

    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()
    const embedded = await readEmbeddedManifest(result.archiveBytes)
    expect(embedded.private).toBe(false)
  })

  test('build with omitted private keeps private omitted (no injected default)', async () => {
    const dir = await createFixtureDir('private-omitted')
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'default-facet',
        version: '1.0.0',
        skills: { example: { description: 'An example skill' } },
      }),
    )

    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()
    const embedded = await readEmbeddedManifest(result.archiveBytes)
    expect('private' in embedded).toBe(false)
  })
})

// --- Adapter API preflight (defense-in-depth gate) ---

describe('runBuildPipeline — adapter API preflight', () => {
  /** A structurally valid adapter whose declared API is not supported.
   *  Contract methods throw so any invocation is loud. */
  function incompatibleAdapter(name: string, apiVersion: unknown): Adapter {
    return {
      name,
      apiVersion,
      supportsInstall: true,
      buildAssetMetadata: () => {
        throw new Error('contract method invoked despite incompatibility')
      },
      async installAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
      async readAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
      async deleteAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
    } as Adapter
  }

  async function validFixture(name: string): Promise<string> {
    const dir = await createFixtureDir(name)
    await Bun.write(join(dir, 'skills/example/SKILL.md'), '# Example skill')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        skills: { example: { description: 'An example skill', adapters: { 'mock-adapter': {} } } },
      }),
    )
    return dir
  }

  test('incompatible adapter fails before any stage runs or method is invoked', async () => {
    const dir = await validFixture('preflight-incompatible')
    const stages: string[] = []
    const result = await runBuildPipeline(dir, [incompatibleAdapter('future-adapter', '9.9')], (progress) => {
      stages.push(progress.stage)
    })
    if (result.ok) expect.unreachable()
    if (result.kind !== 'adapter-incompatible') expect.unreachable()
    expect(result.failures).toEqual([
      { kind: 'api-unsupported', adapter: 'future-adapter', found: '9.9', supported: [ADAPTER_API_VERSION] },
    ])
    // The preflight fires before stage 1 — no stage ever started.
    expect(stages).toEqual([])
  })

  test('multiple incompatible adapters are all collected', async () => {
    const dir = await validFixture('preflight-multiple')
    const result = await runBuildPipeline(dir, [
      incompatibleAdapter('undeclared', undefined),
      incompatibleAdapter('malformed', '0.0.1'),
    ])
    if (result.ok) expect.unreachable()
    if (result.kind !== 'adapter-incompatible') expect.unreachable()
    expect(result.failures.map((f) => f.kind)).toEqual(['api-missing', 'api-malformed'])
  })

  test('a superseded positional 0.0 adapter fails the preflight before any stage', async () => {
    // A bundle built against the earlier positional contract declares 0.0,
    // which a 0.1-only CLI treats as unsupported. The build fails at the
    // preflight before stage 1 and before any contract method is invoked.
    const dir = await validFixture('preflight-positional')
    const stages: string[] = []
    const result = await runBuildPipeline(dir, [incompatibleAdapter('legacy-positional', '0.0')], (progress) => {
      stages.push(progress.stage)
    })
    if (result.ok) expect.unreachable()
    if (result.kind !== 'adapter-incompatible') expect.unreachable()
    expect(result.failures).toEqual([
      { kind: 'api-unsupported', adapter: 'legacy-positional', found: '0.0', supported: [ADAPTER_API_VERSION] },
    ])
    expect(stages).toEqual([])
  })

  test('build with no adapters proceeds and warns about unknown manifest adapters', async () => {
    const dir = await validFixture('preflight-no-adapters')
    const result = await runBuildPipeline(dir, [])
    if (!result.ok) expect.unreachable()
    expect(result.warnings.some((w) => w.includes('unknown adapter "mock-adapter"'))).toBe(true)
  })

  test('compatible SDK-stamped adapter passes the preflight', async () => {
    const dir = await validFixture('preflight-compatible')
    const result = await runBuildPipeline(dir, [mockAdapter])
    if (!result.ok) expect.unreachable()
    expect(result.warnings).toEqual([])
  })
})

// --- Producer: 0.2 supplementary files (task 11.5) ---
//
// The pure path-grammar/collision failure classes are exhaustively tested in
// packages/protocol/src/__tests__/archive-plan.test.ts, and the
// filesystem-identity classes in
// packages/engine/src/build/__tests__/load-supplementary-sources.test.ts.
// These pipeline-level tests prove the producer emits the current 0.2 archive
// with supplementary membership, hashes every entry, stays deterministic, and
// preserves prior dist/ on input failure.

describe('runBuildPipeline — 0.2 supplementary files', () => {
  async function writeFacet(dir: string, manifest: Record<string, unknown>): Promise<void> {
    await Bun.write(join(dir, 'facet.json'), JSON.stringify(manifest))
  }

  test('archives a top-level README, a nested companion, and binary + empty bytes', async () => {
    const dir = await createFixtureDir('supp-success')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    await Bun.write(join(dir, 'README.md'), '# my facet\n')
    await Bun.write(join(dir, 'skills/review/references/api.md'), 'api docs\n')
    await Bun.write(join(dir, 'skills/review/assets/logo.bin'), new Uint8Array([0, 1, 2, 255]))
    await Bun.write(join(dir, 'skills/review/EMPTY'), '')
    await writeFacet(dir, {
      name: 'supp',
      version: '1.0.0',
      files: ['README.md'],
      skills: {
        review: { description: 'r', files: ['references/api.md', 'assets/logo.bin', 'EMPTY'] },
      },
    })

    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()

    // Complete file map covers manifest + primary + every supplementary entry.
    expect(Object.keys(result.fileHashes).sort()).toEqual([
      'README.md',
      'facet.json',
      'skills/review/EMPTY',
      'skills/review/SKILL.md',
      'skills/review/assets/logo.bin',
      'skills/review/references/api.md',
    ])
    // Empty file is hashed (SHA-256 of zero bytes).
    expect(result.fileHashes['skills/review/EMPTY']).toBe(computeContentHash(new Uint8Array(0)))
    // Binary bytes hashed verbatim.
    expect(result.fileHashes['skills/review/assets/logo.bin']).toBe(computeContentHash(new Uint8Array([0, 1, 2, 255])))
    expect(result.facetVersion).toBe(0.2)
  })

  test('inner archive contains every supplementary entry byte-for-byte', async () => {
    const dir = await createFixtureDir('supp-inner')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    const binary = new Uint8Array([9, 8, 7, 0, 255])
    await Bun.write(join(dir, 'skills/review/logo.bin'), binary)
    await Bun.write(join(dir, 'README.md'), '# readme\n')
    await writeFacet(dir, {
      name: 'supp',
      version: '1.0.0',
      files: ['README.md'],
      skills: { review: { description: 'r', files: ['logo.bin'] } },
    })

    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()

    const outer = parseTar(result.archiveBytes)
    const inner = outer.find((e) => e.name === 'archive.tar.gz')
    if (!inner?.data) throw new Error('inner archive missing')
    const innerFiles = await parseTarGzip(inner.data)
    const logo = innerFiles.find((f) => f.name === 'skills/review/logo.bin')
    expect(logo?.data ? new Uint8Array(logo.data) : undefined).toEqual(binary)
  })

  test('the embedded facet.json is hashed as its exact source bytes', async () => {
    const dir = await createFixtureDir('supp-manifest-bytes')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    // Deliberately non-canonical spacing — the hash must cover these exact bytes.
    const manifestBytes =
      '{\n  "name": "supp",\n  "version": "1.0.0",\n  "skills": { "review": { "description": "r" } }\n}\n'
    await Bun.write(join(dir, 'facet.json'), manifestBytes)

    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()
    expect(result.fileHashes['facet.json']).toBe(computeContentHash(manifestBytes))
  })

  test('canonical tar output is byte-identical across two builds', async () => {
    const build = async (name: string) => {
      const dir = await createFixtureDir(name)
      await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
      await Bun.write(join(dir, 'README.md'), '# readme\n')
      await writeFacet(dir, {
        name: 'supp',
        version: '1.0.0',
        files: ['README.md'],
        skills: { review: { description: 'r' } },
      })
      const result = await runBuildPipeline(dir)
      if (!result.ok) expect.unreachable()
      return result
    }
    const a = await build('supp-determinism-a')
    const b = await build('supp-determinism-b')
    expect(a.integrity).toBe(b.integrity)
    expect(Array.from(a.archiveBytes)).toEqual(Array.from(b.archiveBytes))
  })

  test('a scoped facet identity writes under a nested dist path', async () => {
    const dir = await createFixtureDir('supp-scoped')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    await writeFacet(dir, {
      name: '@acme/supp',
      version: '2.0.0',
      skills: { review: { description: 'r' } },
    })
    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()
    expect(result.archiveFilename).toBe('@acme/supp-2.0.0.facet')
    await writeBuildOutput(result, dir)
    expect(await Bun.file(join(dir, 'dist/@acme/supp-2.0.0.facet')).exists()).toBe(true)
  })

  test('a missing declared supplementary file fails and preserves prior dist output', async () => {
    const dir = await createFixtureDir('supp-preserve-dist')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    await writeFacet(dir, {
      name: 'supp',
      version: '1.0.0',
      files: ['README.md'],
      skills: { review: { description: 'r' } },
    })
    // README.md is declared but does NOT exist. Seed a prior dist/ artifact.
    await Bun.write(join(dir, 'dist/prior.txt'), 'keep me')

    const result = await runBuildPipeline(dir)
    if (result.ok) expect.unreachable()
    if (result.kind !== 'validation') expect.unreachable()
    expect(result.errors.some((e) => e.message.includes('README.md'))).toBe(true)
    // Prior dist/ output is untouched — writeBuildOutput never ran.
    expect(await Bun.file(join(dir, 'dist/prior.txt')).text()).toBe('keep me')
  })

  test('a traversal path in a declaration is rejected at manifest validation, preserving dist', async () => {
    const dir = await createFixtureDir('supp-traversal')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    await writeFacet(dir, {
      name: 'supp',
      version: '1.0.0',
      files: ['../secret'],
      skills: { review: { description: 'r' } },
    })
    await Bun.write(join(dir, 'dist/prior.txt'), 'keep me')

    const result = await runBuildPipeline(dir)
    if (result.ok) expect.unreachable()
    if (result.kind !== 'validation') expect.unreachable()
    // The unsafe path is rejected before any output is touched.
    expect(await Bun.file(join(dir, 'dist/prior.txt')).text()).toBe('keep me')
  })

  test('a supplementary/primary path collision is rejected at manifest validation', async () => {
    const dir = await createFixtureDir('supp-collision')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    await Bun.write(join(dir, 'agents/reviewer.md'), '# reviewer\n')
    await writeFacet(dir, {
      name: 'supp',
      version: '1.0.0',
      // Declares an archive-only file that collides with the agent primary path.
      files: ['agents/reviewer.md'],
      skills: { review: { description: 'r' } },
      agents: { reviewer: { description: 'a' } },
    })
    const result = await runBuildPipeline(dir)
    if (result.ok) expect.unreachable()
    expect(result.kind).toBe('validation')
  })

  test('undeclared source-tree files are never packaged', async () => {
    const dir = await createFixtureDir('supp-undeclared')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    // An undeclared stray file next to the manifest.
    await Bun.write(join(dir, 'notes.txt'), 'private notes')
    await writeFacet(dir, {
      name: 'supp',
      version: '1.0.0',
      skills: { review: { description: 'r' } },
    })
    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()
    // Only declared entries are in the archive; the stray file is absent.
    expect(Object.keys(result.fileHashes)).not.toContain('notes.txt')
  })

  test('an asset-only facet still emits 0.2 with a complete files map', async () => {
    const dir = await createFixtureDir('supp-asset-only')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# review\n')
    await writeFacet(dir, {
      name: 'supp',
      version: '1.0.0',
      skills: { review: { description: 'r' } },
    })
    const result = await runBuildPipeline(dir)
    if (!result.ok) expect.unreachable()
    expect(result.facetVersion).toBe(0.2)
    expect(Object.keys(result.fileHashes).sort()).toEqual(['facet.json', 'skills/review/SKILL.md'])
    const manifest = JSON.parse(result.manifestJson)
    expect(manifest.files).toBeDefined()
    expect(manifest.assets).toBeUndefined()
  })
})
