import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnCli } from './helpers/cli-process.ts'

/**
 * `facet update` through the compiled binary.
 *
 * Everything asserted here is something only the real process can show:
 * which stream a message lands on, what the exit code is, and that two
 * spellings of the command produce byte-identical output. The applying
 * paths — resolution, the transaction, stale plans, rollback — are
 * driven against a real project tree by the engine's own suite, which
 * can do it without standing up a registry.
 *
 * No test here reaches the network. Each project is arranged so update
 * fails or completes before any registry lookup would be issued.
 */

const projects: string[] = []

function project(manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'facet-update-e2e-'))
  projects.push(dir)
  writeFileSync(join(dir, 'facets.json'), JSON.stringify(manifest, null, 2))
  return dir
}

afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('facet update — the command surface', () => {
  test('global help lists update with upgrade as its alias', async () => {
    const result = await spawnCli(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/update,\s*upgrade/)
  })

  test('per-command help lists every supported flag, in both spellings', async () => {
    const result = await spawnCli(['update', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: facet update')
    expect(result.stdout).toMatch(/-L, --latest\s+/)
    expect(result.stdout).toMatch(/-i, --interactive\s+/)
    expect(result.stdout).toMatch(/--dry-run\s+/)
    expect(result.stdout).toMatch(/--verbose\s+/)
    expect(result.stdout).toMatch(/--accept-mcp\s+/)
  })

  test('help does not offer a frozen mode, which update has no meaning for', async () => {
    const result = await spawnCli(['update', '--help'])
    expect(result.stdout).not.toContain('--frozen-lockfile')
  })

  test('help distinguishes project facets from the CLI binary', async () => {
    const result = await spawnCli(['update', '--help'])
    expect(result.stdout).toContain('self-update')
  })

  test('the alias produces byte-identical help', async () => {
    const canonical = await spawnCli(['update', '--help'], { trim: false })
    const alias = await spawnCli(['upgrade', '--help'], { trim: false })
    expect(alias.exitCode).toBe(0)
    expect(alias.stdout).toBe(canonical.stdout)
  })

  test('upgrade no longer reports itself as unimplemented', async () => {
    const dir = project({ facets: {} })
    const result = await spawnCli(['upgrade'], { cwd: dir })
    expect(result.stdout).not.toContain('not yet implemented')
    expect(result.exitCode).toBe(0)
  })
})

describe('facet update — refused invocations', () => {
  test('a positional argument exits 1 and points at --interactive', async () => {
    const dir = project({ facets: {} })
    const result = await spawnCli(['update', 'cowsay'], { cwd: dir })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('does not accept positional arguments')
    expect(result.stderr).toContain('--interactive')
    expect(result.stdout).toBe('')
  })

  // stdin is closed by the spawn helper, so this is the real
  // non-interactive case rather than a simulated one.
  test('--interactive without a terminal exits 1 on stderr', async () => {
    const dir = project({ facets: {} })
    const result = await spawnCli(['update', '--interactive'], { cwd: dir })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('interactive terminal')
  })

  test('the short alias reaches the same gate', async () => {
    const dir = project({ facets: {} })
    const long = await spawnCli(['update', '--interactive'], { cwd: dir })
    const short = await spawnCli(['update', '-i'], { cwd: dir })
    expect(short.exitCode).toBe(long.exitCode)
    expect(short.stderr).toBe(long.stderr)
  })

  test('a malformed facets.json exits 1 and names the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'facet-update-e2e-'))
    projects.push(dir)
    writeFileSync(join(dir, 'facets.json'), '{not json')
    const result = await spawnCli(['update'], { cwd: dir })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('facets.json')
  })
})

describe('facet update — successful no-ops', () => {
  test('an empty project says there is nothing to check and exits 0', async () => {
    const dir = project({ facets: {} })
    const result = await spawnCli(['update'], { cwd: dir })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No registry facets to update')
    expect(result.stderr).toBe('')
  })

  test('git and local facets are named as unsupported, not reported as current', async () => {
    const dir = project({ facets: { plans: 'github:agent-facets/viper-plans#main' } })
    const result = await spawnCli(['update'], { cwd: dir })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No registry facets to update')
    expect(result.stdout).not.toContain('current')
  })

  // A directory with no facets.json declares no facets, which is the
  // same fact as declaring none — not an error to report.
  test('a directory that is not a project yet has nothing to update', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'facet-update-e2e-'))
    projects.push(dir)
    const result = await spawnCli(['update'], { cwd: dir })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No registry facets to update')
  })

  test('a dry run over a project with nothing to check exits 0 and installs no adapter', async () => {
    const dir = project({ facets: {} })
    const result = await spawnCli(['update', '--dry-run'], { cwd: dir })
    expect(result.exitCode).toBe(0)
    // Adapter discovery is downstream of the preview; reaching it would
    // have written this line.
    expect(result.stderr).not.toContain('no adapters installed')
  })
})

describe('facet update — a project that cannot be checked', () => {
  // Update refuses to guess what is installed. Repairing that is
  // `facet install`'s job, and this run has to say so rather than
  // reporting a facet it never checked as current.
  test('a declared registry facet with no lockfile entry exits 1 and sends the user to install', async () => {
    const dir = project({ facets: { cowsay: '1.*', fortune: '2.*' } })
    const result = await spawnCli(['update'], { cwd: dir })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('cowsay')
    expect(result.stderr).toContain('fortune')
    expect(result.stderr).toContain('facet install')
  })

  test('the same project fails the same way under --latest and --dry-run', async () => {
    const dir = project({ facets: { cowsay: '1.*' } })
    const latest = await spawnCli(['update', '--latest'], { cwd: dir })
    const preview = await spawnCli(['update', '--dry-run'], { cwd: dir })
    expect(latest.exitCode).toBe(1)
    expect(preview.exitCode).toBe(1)
    expect(preview.stderr).toContain('facet install')
  })
})
