import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Run the compiled CLI binary with the given args. Forces dev-mode so
 * none of the network or subprocess paths run — the binary detects
 * `local-dev` and refuses with exit 1. That's the only deterministic
 * behavior we can assert against in CI without a real registry, real
 * `~/.facet/bin`, or real package managers.
 */
async function runCli(args: string[], env: Record<string, string> = {}): Promise<ExecResult> {
  const proc = Bun.spawn([CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      // FACET_BIN_OVERRIDE set ⇒ detection returns 'local-dev', short-circuiting
      // before any network / subprocess work.
      FACET_BIN_OVERRIDE: CLI_PATH,
      ...env,
    },
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

describe('self-update — e2e', () => {
  test('global help lists self-update with self-upgrade alias inline', async () => {
    const result = await runCli(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/self-update,\s*self-upgrade/)
  })

  test('self-update --help renders canonical-name usage and both flags', async () => {
    const result = await runCli(['self-update', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: facet self-update')
    expect(result.stdout).toMatch(/--version\s+Pin to a specific version/)
    expect(result.stdout).toMatch(/--dry-run\s+Print the plan/)
  })

  test('self-upgrade --help resolves to the same canonical-name help output', async () => {
    const a = await runCli(['self-update', '--help'])
    const b = await runCli(['self-upgrade', '--help'])
    expect(b.exitCode).toBe(0)
    expect(b.stdout).toBe(a.stdout)
  })

  test('dev-mode refuses self-update with exit 1 and a clear stderr message', async () => {
    const result = await runCli(['self-update'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('disabled in dev mode')
    expect(result.stderr).toContain('FACET_BIN_OVERRIDE')
  })

  test('dev-mode refuses self-upgrade alias the same way', async () => {
    const result = await runCli(['self-upgrade'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('disabled in dev mode')
  })

  test('dev-mode refuses self-update --dry-run too', async () => {
    // The local-dev refusal applies regardless of --dry-run; the
    // orchestrator dispatches to the local-dev method which always exits 1.
    const result = await runCli(['self-update', '--dry-run'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('disabled in dev mode')
  })

  test('typo of self-upgrade surfaces the alias in the suggestion', async () => {
    const result = await runCli(['self-upgrad'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command "self-upgrad"')
    expect(result.stderr).toContain('Did you mean "self-upgrade"')
  })
})
