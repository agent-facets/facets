import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnCli } from './helpers/cli-process.ts'
import { installFakeAdapter } from './helpers/fake-adapter.ts'

/**
 * End-to-end tests for `facet remove` that spawn the compiled `./dist/facet`
 * binary as a subprocess. These cover the CLI surface — argv parsing, help
 * listing + `rm` alias, and usage errors — that the engine unit tests
 * cannot exercise.
 *
 * The full remove transaction (manifest mutation, asset pruning, lockfile
 * regeneration, undeclared-facet failure, multi-name atomicity, and
 * install-failure rollback) is covered end-to-end against real
 * materialization by the engine's `run-remove.test.ts`. Driving those paths
 * through the compiled binary would require a working installed adapter
 * (and a seeded facet), which the engine suite already exercises directly,
 * so this file stays focused on argv/help/usage behavior.
 */

const runCli = (args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => spawnCli(args, opts)

// --- Help / alias ---

describe('facet remove — help', () => {
  test('--help lists remove with its rm alias', async () => {
    const result = await runCli(['--help'])
    expect(result.exitCode).toBe(0)
    // remove is implemented, so it appears in global help, comma-joined with rm.
    expect(result.stdout).toMatch(/^\s+remove,\s*rm\s/m)
    expect(result.stderr).toBe('')
  })

  test('remove --help shows usage and --verbose flag', async () => {
    const result = await runCli(['remove', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('facet remove')
    expect(result.stdout).toContain('[more facets...]')
    expect(result.stdout).toContain('--verbose')
    expect(result.stderr).toBe('')
  })
})

// --- Usage error ---

describe('facet remove — usage', () => {
  test('no arguments prints usage error and exits 1', async () => {
    const result = await runCli(['remove'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing facet name')
    expect(result.stdout).toBe('')
  })

  test('rm alias with no arguments also errors', async () => {
    const result = await runCli(['rm'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing facet name')
  })
})

// --- Validation ordering: facet checks run before adapter discovery ---

describe('facet remove — validates before adapter discovery', () => {
  let projectRoot: string
  let fakeHome: string
  let adaptersDir: string

  beforeEach(() => {
    projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-rm-e2e-')))
    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-rm-home-')))
    // Empty until a test installs one → zero installed adapters by default.
    adaptersDir = join(fakeHome, '.facet', 'adapters')
    mkdirSync(adaptersDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('an unreadable manifest fails before adapter discovery', async () => {
    // The ordering this phase exists to guarantee: a manifest problem is
    // reported as a manifest problem, not as "no adapters installed".
    writeFileSync(join(projectRoot, 'facets.json'), '{ not json')

    const result = await runCli(['remove', 'ghost'], {
      cwd: projectRoot,
      env: { HOME: fakeHome, FACET_DIR: join(fakeHome, '.facet') },
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('facets.json')
    expect(result.stderr).not.toContain('no adapters installed')
  })

  test('an undeclared name still reaches adapter discovery', async () => {
    // Whether a requested name is declared is decided by the commit, under
    // the project lock — so the CLI cannot skip discovery on the strength of
    // a pre-lock read. In a non-interactive shell with no adapters, that
    // means this fails rather than reporting a no-op it never verified.
    const before = `${JSON.stringify({ facets: { cowsay: '0.1.1' } }, null, 2)}\n`
    writeFileSync(join(projectRoot, 'facets.json'), before)

    const result = await runCli(['remove', 'ghost'], {
      cwd: projectRoot,
      env: { HOME: fakeHome, FACET_DIR: join(fakeHome, '.facet') },
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('no adapters installed')
    // Still nothing removed: the manifest is byte-for-byte unchanged.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before)
  })

  test('an undeclared name reaches the commit when an adapter is installed', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    writeFileSync(join(projectRoot, 'facets.json'), `${JSON.stringify({ facets: {} }, null, 2)}\n`)

    const result = await runCli(['remove', 'ghost'], {
      cwd: projectRoot,
      env: { HOME: fakeHome, FACET_DIR: join(fakeHome, '.facet') },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('no changes')
    expect(result.stderr).not.toContain('no adapters installed')
    // The lockfile did not exist before this run, so its arrival is proof the
    // request reached the commit rather than being answered by a pre-lock read.
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(true)
    expect(JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).facets).toEqual({})
  })
})
