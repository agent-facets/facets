import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadManifest, resolvePrompts } from '../loaders/facet.ts'

let testDir: string

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'facet-loader-test-'))
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

async function writeFixture(dir: string, filename: string, content: string) {
  const path = join(dir, filename)
  await Bun.write(path, content)
  return path
}

async function createFixtureDir(name: string): Promise<string> {
  const dir = join(testDir, name)
  await Bun.write(join(dir, '.keep'), '') // ensure dir exists
  return dir
}

// --- loadManifest ---

describe('loadManifest', () => {
  test('successful load', async () => {
    const dir = await createFixtureDir('valid')
    await writeFixture(
      dir,
      'facet.json',
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          'code-review': {
            description: 'Reviews code for issues',
          },
        },
      }),
    )

    const result = await loadManifest(dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('test-facet')
      expect(result.data.version).toBe('1.0.0')
      expect(result.data.skills?.['code-review']?.description).toBe('Reviews code for issues')
    }
  })

  test('file not found', async () => {
    const dir = await createFixtureDir('missing')

    const result = await loadManifest(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors.at(0)?.message).toContain('File not found')
    }
  })

  test('malformed JSON', async () => {
    const dir = await createFixtureDir('malformed')
    await writeFixture(dir, 'facet.json', '{ "name": [unterminated')

    const result = await loadManifest(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors.at(0)?.message).toContain('JSON syntax error')
    }
  })

  test('schema validation errors with correct paths', async () => {
    const dir = await createFixtureDir('schema-error')
    await writeFixture(
      dir,
      'facet.json',
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        agents: {
          reviewer: {
            // missing required description
          },
        },
      }),
    )

    const result = await loadManifest(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const descriptionError = result.errors.find((e) => e.path.includes('description'))
      expect(descriptionError).toBeDefined()
    }
  })

  test('no text assets → business-rule error', async () => {
    const dir = await createFixtureDir('no-text')
    await writeFixture(
      dir,
      'facet.json',
      JSON.stringify({
        name: 'empty-facet',
        version: '1.0.0',
        servers: {
          jira: '1.0.0',
        },
      }),
    )

    const result = await loadManifest(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.at(0)?.message).toContain('at least one text asset')
    }
  })

  test('full manifest loads successfully', async () => {
    const dir = await createFixtureDir('full')
    await writeFixture(
      dir,
      'facet.json',
      JSON.stringify({
        name: 'acme-dev',
        version: '1.0.0',
        description: 'Acme dev toolkit',
        author: 'acme-org',
        skills: {
          'code-standards': {
            description: 'Org coding standards',
          },
        },
        agents: {
          reviewer: {
            description: 'Code reviewer',
          },
        },
        commands: {
          review: {
            description: 'Run review',
          },
        },
        facets: ['base@1.0.0'],
        servers: {
          jira: '1.0.0',
          slack: {
            image: 'ghcr.io/acme/slack-bot:v2',
          },
        },
      }),
    )

    const result = await loadManifest(dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('acme-dev')
      expect(result.data.agents?.reviewer?.description).toBe('Code reviewer')
      expect(result.data.servers?.slack).toEqual({
        image: 'ghcr.io/acme/slack-bot:v2',
      })
    }
  })
})

// --- resolvePrompts ---

describe('resolvePrompts', () => {
  test('prompt content is resolved from conventional file paths', async () => {
    const dir = await createFixtureDir('resolve-convention')
    await writeFixture(dir, 'skills/review/SKILL.md', '# Code Review\nReview all code.')
    await writeFixture(dir, 'agents/reviewer.md', '# Reviewer\nReview this code.')
    await writeFixture(dir, 'commands/deploy.md', '# Deploy\nDeploy the code.')

    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: {
        review: { description: 'A review skill' },
      },
      agents: {
        reviewer: { description: 'A reviewer agent' },
      },
      commands: {
        deploy: { description: 'A deploy command' },
      },
    }

    const result = await resolvePrompts(manifest, dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.skills?.review?.prompt).toBe('# Code Review\nReview all code.')
      expect(result.data.agents?.reviewer?.prompt).toBe('# Reviewer\nReview this code.')
      expect(result.data.commands?.deploy?.prompt).toBe('# Deploy\nDeploy the code.')
    }
  })

  test('file-based prompt is resolved from agents/<name>.md', async () => {
    const dir = await createFixtureDir('resolve-file')
    await writeFixture(dir, 'agents/reviewer.md', '# Review\nCheck all code.')

    const manifest = {
      name: 'test',
      version: '1.0.0',
      agents: {
        reviewer: { description: 'A reviewer' },
      },
    }

    const result = await resolvePrompts(manifest, dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.agents?.reviewer?.prompt).toBe('# Review\nCheck all code.')
    }
  })

  test('missing prompt file reports error with asset name', async () => {
    const dir = await createFixtureDir('resolve-missing')

    const manifest = {
      name: 'test',
      version: '1.0.0',
      agents: {
        reviewer: { description: 'A reviewer' },
      },
    }

    const result = await resolvePrompts(manifest, dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors.at(0)?.path).toBe('agents.reviewer')
      expect(result.errors.at(0)?.message).toContain('agents/reviewer.md')
    }
  })

  test('manifest without agents or commands resolves successfully', async () => {
    const dir = await createFixtureDir('resolve-skills-only')
    await writeFixture(dir, 'skills/x/SKILL.md', '# Skill X\nDo x.')

    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: {
        x: {
          description: 'A skill',
        },
      },
    }

    const result = await resolvePrompts(manifest, dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('test')
      expect(result.data.skills?.x?.prompt).toBe('# Skill X\nDo x.')
    }
  })
})
