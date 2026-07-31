import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_VERSION, writeScaffold } from '@agent-facets/engine'
import { spawnCli } from './helpers/cli-process.ts'

let testDir: string

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'cli-modify-test-'))
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

const runCli = (...args: string[]) => spawnCli(args)

/**
 * Scaffold a fresh facet in its own dir and return the path. Includes a skill
 * AND an agent so that removing one asset still leaves the manifest valid (a
 * facet must always declare at least one asset).
 */
async function fixture(name: string): Promise<string> {
  const dir = join(testDir, name)
  await writeScaffold(
    {
      name: 'my-facet',
      version: DEFAULT_VERSION,
      description: 'x',
      skills: ['greet'],
      agents: ['helper'],
      commands: [],
      readme: { kind: 'disabled' },
    },
    dir,
  )
  return dir
}

function readManifest(dir: string): Promise<Record<string, unknown>> {
  return Bun.file(join(dir, 'facet.json'))
    .text()
    .then((t) => JSON.parse(t))
}

describe('facet modify — asset lifecycle', () => {
  test('adds an asset (manifest entry + scaffolded file) with adapter config, emitting JSON', async () => {
    const dir = await fixture('add-asset')
    const result = await runCli(
      'modify',
      'command',
      'deploy',
      dir,
      '--add',
      '--description',
      'Deploy it',
      '--adapter-claude-code',
      '{"permission":{"bash":"ask"}}',
      '--json',
    )
    expect(result.exitCode).toBe(0)
    const doc = JSON.parse(result.stdout)
    expect(doc.ok).toBe(true)

    const manifest = await readManifest(dir)
    const commands = manifest.commands as Record<string, { description: string; adapters?: Record<string, unknown> }>
    const deploy = commands.deploy
    if (!deploy) expect.unreachable()
    expect(deploy.description).toBe('Deploy it')
    expect(deploy.adapters?.['claude-code']).toEqual({ permission: { bash: 'ask' } })
    expect(existsSync(join(dir, 'commands/deploy.md'))).toBe(true)
  })

  test('renames an asset and moves its file, cleaning the empty skill dir', async () => {
    const dir = await fixture('rename-asset')
    const result = await runCli('modify', 'skill', 'greet', dir, '--rename', 'welcome')
    expect(result.exitCode).toBe(0)

    const manifest = await readManifest(dir)
    const skills = manifest.skills as Record<string, unknown>
    expect(skills.welcome).toBeDefined()
    expect(skills.greet).toBeUndefined()
    expect(existsSync(join(dir, 'skills/welcome/SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, 'skills/greet'))).toBe(false)
  })

  test('removes an asset and deletes its file', async () => {
    const dir = await fixture('remove-asset')
    const result = await runCli('modify', 'skill', 'greet', dir, '--remove')
    expect(result.exitCode).toBe(0)
    const manifest = await readManifest(dir)
    expect(manifest.skills).toBeUndefined()
    // The agent remains, so the manifest is still valid.
    expect(manifest.agents).toBeDefined()
    expect(existsSync(join(dir, 'skills/greet/SKILL.md'))).toBe(false)
  })
})

describe('facet modify — facet metadata', () => {
  test('sets version via `modify facet --version` (not shadowed by global --version)', async () => {
    const dir = await fixture('facet-meta')
    const result = await runCli('modify', 'facet', dir, '--version', '2.0.0')
    expect(result.exitCode).toBe(0)
    const manifest = await readManifest(dir)
    expect(manifest.version).toBe('2.0.0')
  })
})

describe('facet modify — rejected operations', () => {
  test('conflicting lifecycle verbs are rejected', async () => {
    const dir = await fixture('conflict')
    const result = await runCli('modify', 'skill', 'greet', dir, '--remove', '--rename', 'x')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('conflicting operations')
  })

  test('invalid adapter JSON is rejected', async () => {
    const dir = await fixture('bad-json')
    const result = await runCli('modify', 'skill', 'greet', dir, '--adapter-claude', '{not json')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('invalid JSON')
  })
})
