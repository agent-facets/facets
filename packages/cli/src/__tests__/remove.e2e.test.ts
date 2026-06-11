import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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

type ExecResult = { stdout: string; stderr: string; exitCode: number }

async function runCli(args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<ExecResult> {
  const proc = Bun.spawn([CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: opts?.cwd,
    env: { ...process.env, ...opts?.env },
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

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

  beforeEach(() => {
    projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-rm-e2e-')))
    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-rm-home-')))
    // An empty adapters dir → zero installed adapters.
    mkdirSync(join(fakeHome, '.facet', 'adapters'), { recursive: true })
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('removing an undeclared facet prints no-op summary without discovering adapters', async () => {
    // Valid manifest that declares one facet — but NOT the one we remove.
    const before = `${JSON.stringify({ facets: { cowsay: '0.1.1' } }, null, 2)}\n`
    writeFileSync(join(projectRoot, 'facets.json'), before)

    const result = await runCli(['remove', 'ghost'], {
      cwd: projectRoot,
      env: { HOME: fakeHome, FACET_DIR: join(fakeHome, '.facet') },
    })

    expect(result.exitCode).toBe(0)
    // No-op summary printed — the one declared facet is counted.
    expect(result.stdout).toContain('Checked 1 facet')
    expect(result.stdout).toContain('no changes')
    // No error output — undeclared facets are silently ignored, and
    // adapter discovery is skipped entirely (no "no adapters installed").
    expect(result.stderr).not.toContain('not declared')
    expect(result.stderr).not.toContain('no adapters installed')
    // Nothing was removed: the manifest is byte-for-byte unchanged.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before)
  })
})
