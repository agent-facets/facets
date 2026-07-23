import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_VERSION, writeScaffold } from '@agent-facets/engine'

let testDir: string

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'cli-create-build-test-'))
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

async function createFixtureDir(name: string): Promise<string> {
  const dir = join(testDir, name)
  await Bun.write(join(dir, '.keep'), '')
  return dir
}

const CLI_PATH = resolve(import.meta.dir, '../../dist/facet')

if (!existsSync(CLI_PATH)) {
  throw new Error(
    `[e2e] dist/facet not found at ${CLI_PATH}.\n` +
      `Build the CLI first:\n` +
      `  bun run --cwd packages/cli build\n` +
      `Or run the full check pipeline:\n` +
      `  bun check`,
  )
}

async function runCli(...args: string[]) {
  // Hermetic FACET_DIR: `facet build` fail-closed-loads installed
  // adapters, so inheriting the developer's real ~/.facet (which may
  // hold legacy incompatible bundles) would leak machine state into
  // these tests. An empty temp dir means "no adapters installed", and
  // builds proceed with unknown-adapter warnings. Created under `testDir`
  // so the suite's afterAll cleanup sweeps it — no per-call leak.
  const facetDir = await mkdtemp(join(testDir, 'facet-dir-'))
  const proc = Bun.spawn([CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1', FACET_DIR: facetDir },
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  // Don't let build errors flood test output — capture but don't dump
  if (exitCode !== 0 && stderr.trim()) {
    const lines = stderr.trim().split('\n')
    const summary =
      lines.length > 3 ? [...lines.slice(0, 3), `... (${lines.length - 3} more lines)`].join('\n') : stderr.trim()
    return { stdout: stdout.trim(), stderr: summary, exitCode }
  }

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

// --- Scaffold generation (unit) ---

describe('writeScaffold', () => {
  test('scaffolds with named assets across all types', async () => {
    const dir = await createFixtureDir('scaffold-all')
    const files = await writeScaffold(
      {
        name: 'my-facet',
        version: DEFAULT_VERSION,
        description: 'A test facet',
        skills: ['code-review', 'testing-guide'],
        agents: ['reviewer'],
        commands: ['deploy'],
      },
      dir,
    )

    expect(files).toContain('facet.json')
    expect(files).toContain('skills/code-review/SKILL.md')
    expect(files).toContain('skills/testing-guide/SKILL.md')
    expect(files).toContain('agents/reviewer.md')
    expect(files).toContain('commands/deploy.md')

    // Verify manifest content (JSON)
    const manifestText = await Bun.file(join(dir, 'facet.json')).text()
    const manifest = JSON.parse(manifestText)
    expect(manifest.name).toBe('my-facet')
    expect(manifest.version).toBe(DEFAULT_VERSION)
    expect(manifest.description).toBe('A test facet')
    expect(manifest.skills).toBeDefined()
    expect(manifest.skills['code-review']).toBeDefined()
    expect(manifest.skills['testing-guide']).toBeDefined()
    expect(manifest.agents).toBeDefined()
    expect(manifest.agents.reviewer).toBeDefined()
    expect(manifest.commands).toBeDefined()
    expect(manifest.commands.deploy).toBeDefined()

    // Verify starter files exist and have named template content
    const skill = await Bun.file(join(dir, 'skills/code-review/SKILL.md')).text()
    expect(skill).toContain('# Code Review')

    const skill2 = await Bun.file(join(dir, 'skills/testing-guide/SKILL.md')).text()
    expect(skill2).toContain('# Testing Guide')

    const agent = await Bun.file(join(dir, 'agents/reviewer.md')).text()
    expect(agent).toContain('# Reviewer')

    const command = await Bun.file(join(dir, 'commands/deploy.md')).text()
    expect(command).toContain('# Deploy')
  })

  test('scaffolds with only one skill', async () => {
    const dir = await createFixtureDir('scaffold-skills-only')
    const files = await writeScaffold(
      {
        name: 'minimal',
        version: DEFAULT_VERSION,
        description: '',
        skills: ['minimal'],
        agents: [],
        commands: [],
      },
      dir,
    )

    expect(files).toContain('facet.json')
    expect(files).toContain('skills/minimal/SKILL.md')
    expect(files).not.toContain('agents/')
    expect(files).not.toContain('commands/')

    const manifestText = await Bun.file(join(dir, 'facet.json')).text()
    const manifest = JSON.parse(manifestText)
    expect(manifest.skills).toBeDefined()
    expect(manifest.agents).toBeUndefined()
    expect(manifest.commands).toBeUndefined()
  })

  test('version defaults to DEFAULT_VERSION (0.0.0)', async () => {
    const dir = await createFixtureDir('scaffold-default-version')
    await writeScaffold(
      {
        name: 'default-ver',
        version: DEFAULT_VERSION,
        description: 'Testing default version',
        skills: ['example'],
        agents: [],
        commands: [],
      },
      dir,
    )

    const manifestText = await Bun.file(join(dir, 'facet.json')).text()
    const manifest = JSON.parse(manifestText)
    expect(manifest.version).toBe('0.0.0')
  })

  test('scaffolds a scoped facet and builds it to a nested dist/ path', async () => {
    const dir = await createFixtureDir('scaffold-scoped')
    const files = await writeScaffold(
      {
        name: '@julian/cowsay',
        version: DEFAULT_VERSION,
        description: 'Cowsay tools',
        // The default first-asset name suggestion is the unscoped segment
        // (`cowsay`), so a scoped scaffold uses a plain kebab asset name.
        skills: ['cowsay'],
        agents: [],
        commands: [],
      },
      dir,
    )

    // The manifest carries the scoped identity verbatim; the asset path is
    // derived from the (unscoped) asset name.
    expect(files).toContain('skills/cowsay/SKILL.md')
    const manifest = JSON.parse(await Bun.file(join(dir, 'facet.json')).text())
    expect(manifest.name).toBe('@julian/cowsay')

    // The scoped project builds, and the archive lands at the nested path.
    const result = await runCli('build', dir)
    expect(result.exitCode).toBe(0)
    const distArchive = await Bun.file(join(dir, `dist/@julian/cowsay-${DEFAULT_VERSION}.facet`)).exists()
    expect(distArchive).toBe(true)
  })

  test('scaffolded project passes build', async () => {
    const dir = await createFixtureDir('scaffold-buildable')
    await writeScaffold(
      {
        name: 'buildable',
        version: DEFAULT_VERSION,
        description: 'A buildable facet',
        skills: ['helper'],
        agents: ['assistant'],
        commands: [],
      },
      dir,
    )

    // Run facet build against the scaffolded project
    const result = await runCli('build', dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Built buildable')

    // Verify dist/ output exists — self-contained .facet archive only
    const distArchive = await Bun.file(join(dir, `dist/buildable-${DEFAULT_VERSION}.facet`)).exists()
    expect(distArchive).toBe(true)

    // No loose manifest by default (requires --emit-manifest)
    const distManifest = await Bun.file(join(dir, 'dist/build-manifest.json')).exists()
    expect(distManifest).toBe(false)

    // No loose asset files
    const looseManifest = await Bun.file(join(dir, 'dist/facet.json')).exists()
    expect(looseManifest).toBe(false)
  })
})

// --- Headless create (e2e) ---

describe('facet create — headless', () => {
  test('scaffolds a facet from flags and emits JSON', async () => {
    const dir = await createFixtureDir('create-headless')
    const result = await runCli(
      'create',
      dir,
      '--name',
      'my-facet',
      '--description',
      'A headless facet',
      '--skill',
      'greet',
      '--agent',
      'helper',
      '--json',
    )
    expect(result.exitCode).toBe(0)
    const doc = JSON.parse(result.stdout)
    expect(doc.ok).toBe(true)
    expect(doc.name).toBe('my-facet')
    expect(doc.files).toContain('facet.json')
    expect(doc.files).toContain('skills/greet/SKILL.md')

    const manifest = JSON.parse(await Bun.file(join(dir, 'facet.json')).text())
    expect(manifest.skills.greet).toBeDefined()
    expect(manifest.agents.helper).toBeDefined()
  })

  test('missing --name fails with a clear error', async () => {
    const dir = await createFixtureDir('create-headless-noname')
    const result = await runCli('create', dir, '--skill', 'greet')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing --name')
  })

  test('refuses to overwrite an existing facet.json without --force', async () => {
    const dir = await createFixtureDir('create-headless-overwrite')
    await Bun.write(join(dir, 'facet.json'), JSON.stringify({ name: 'existing', version: '0.0.0' }))
    const result = await runCli('create', dir, '--name', 'my-facet', '--skill', 'greet')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--force')

    // With --force it succeeds.
    const forced = await runCli('create', dir, '--name', 'my-facet', '--skill', 'greet', '--force')
    expect(forced.exitCode).toBe(0)
  })
})

// --- Build command (e2e) ---

describe('facet build', () => {
  test('build succeeds on valid project', async () => {
    const dir = await createFixtureDir('build-valid')
    await Bun.write(join(dir, 'skills/review/SKILL.md'), '# Review skill content')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          review: {
            description: 'Code review skill',
          },
        },
      }),
    )

    const result = await runCli('build', dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Built test-facet')
    expect(result.stdout).toContain('sha256:')
  })

  test('build fails on missing manifest', async () => {
    const dir = await createFixtureDir('build-no-manifest')

    const result = await runCli('build', dir)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('facet.json')
  })

  test('build fails on missing asset file', async () => {
    const dir = await createFixtureDir('build-missing-file')
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'test-facet',
        version: '1.0.0',
        skills: {
          review: {
            description: 'Code review skill',
          },
        },
      }),
    )

    const result = await runCli('build', dir)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('Build failed')
  })
})

// --- Build --verify / --json (e2e) ---

describe('facet build --verify', () => {
  async function scaffoldValid(name: string): Promise<string> {
    const dir = await createFixtureDir(name)
    await writeScaffold(
      { name: 'verifiable', version: DEFAULT_VERSION, description: 'x', skills: ['helper'], agents: [], commands: [] },
      dir,
    )
    return dir
  }

  test('--verify validates without writing dist/', async () => {
    const dir = await scaffoldValid('verify-ok')
    const result = await runCli('build', dir, '--verify')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Verified verifiable')
    expect(existsSync(join(dir, 'dist'))).toBe(false)
  })

  test('--verify --json emits a structured success document', async () => {
    const dir = await scaffoldValid('verify-json')
    const result = await runCli('build', dir, '--verify', '--json')
    expect(result.exitCode).toBe(0)
    const doc = JSON.parse(result.stdout)
    expect(doc.schemaVersion).toBe('2')
    expect(doc.ok).toBe(true)
    expect(doc.verified).toBe(true)
    expect(doc.name).toBe('verifiable')
    expect(doc.facetVersion).toBe(0.2)
    // Complete inner-archive entry listing (includes facet.json + primaries).
    expect(Array.isArray(doc.files)).toBe(true)
    expect(doc.files).toContain('facet.json')
    expect(existsSync(join(dir, 'dist'))).toBe(false)
  })

  test('--verify --json reports errors with exit 1 and no dist/', async () => {
    const dir = await createFixtureDir('verify-json-fail')
    // Manifest references a skill whose file is missing → resolve-prompts error.
    await Bun.write(
      join(dir, 'facet.json'),
      JSON.stringify({ name: 'broken', version: '1.0.0', skills: { review: { description: 'x' } } }),
    )
    const result = await runCli('build', dir, '--verify', '--json')
    expect(result.exitCode).toBe(1)
    const doc = JSON.parse(result.stdout)
    expect(doc.ok).toBe(false)
    expect(doc.verified).toBe(true)
    expect(doc.errors.length).toBeGreaterThan(0)
    expect(existsSync(join(dir, 'dist'))).toBe(false)
  })
})
