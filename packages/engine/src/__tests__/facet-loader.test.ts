import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import dedent from 'dedent'
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

  test('no deliverable at all → business-rule error', async () => {
    const dir = await createFixtureDir('no-deliverable')
    await writeFixture(dir, 'facet.json', JSON.stringify({ name: 'empty-facet', version: '1.0.0' }))

    const result = await loadManifest(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.at(0)?.message).toContain('at least one deliverable')
    }
  })

  test('a server is a sufficient deliverable on its own', async () => {
    const dir = await createFixtureDir('server-only')
    await writeFixture(
      dir,
      'facet.json',
      JSON.stringify({
        name: 'server-only',
        version: '1.0.0',
        servers: { filesystem: { type: 'stdio', command: 'npx', args: ['-y', 'filesystem-mcp'] } },
      }),
    )

    const result = await loadManifest(dir)
    expect(result.ok).toBe(true)
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
          jira: { type: 'stdio', command: 'jira-mcp', args: ['--project', 'ACME'] },
          slack: { type: 'http', url: 'https://mcp.example.com/slack' },
        },
      }),
    )

    const result = await loadManifest(dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('acme-dev')
      expect(result.data.agents?.reviewer?.description).toBe('Code reviewer')
      expect(result.data.servers?.slack).toEqual({ type: 'http', url: 'https://mcp.example.com/slack' })
    }
  })
})

// --- resolvePrompts ---

describe('resolvePrompts', () => {
  test('prompt content is resolved from conventional file paths', async () => {
    const dir = await createFixtureDir('resolve-convention')
    await writeFixture(
      dir,
      'skills/review/SKILL.md',
      dedent`
        # Code Review
        Review all code.
      `,
    )
    await writeFixture(
      dir,
      'agents/reviewer.md',
      dedent`
        # Reviewer
        Review this code.
      `,
    )
    await writeFixture(
      dir,
      'commands/deploy.md',
      dedent`
        # Deploy
        Deploy the code.
      `,
    )

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
      expect(result.data.skills?.review?.prompt).toBe(dedent`
        # Code Review
        Review all code.
      `)
      expect(result.data.agents?.reviewer?.prompt).toBe(dedent`
        # Reviewer
        Review this code.
      `)
      expect(result.data.commands?.deploy?.prompt).toBe(dedent`
        # Deploy
        Deploy the code.
      `)
    }
  })

  test('file-based prompt is resolved from agents/<name>.md', async () => {
    const dir = await createFixtureDir('resolve-file')
    await writeFixture(
      dir,
      'agents/reviewer.md',
      dedent`
        # Review
        Check all code.
      `,
    )

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
      expect(result.data.agents?.reviewer?.prompt).toBe(dedent`
        # Review
        Check all code.
      `)
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
    await writeFixture(
      dir,
      'skills/x/SKILL.md',
      dedent`
        # Skill X
        Do x.
      `,
    )

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
      expect(result.data.skills?.x?.prompt).toBe(dedent`
        # Skill X
        Do x.
      `)
    }
  })
})
