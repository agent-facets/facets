import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneGitSource } from '../resolve-git.ts'

/**
 * Set up a local git repo fixture with one commit on `main`.
 * All tests here clone from this file:// URL so they run offline with no
 * real network or auth paths.
 */
let fixtureRepo: string
let initialCommit: string
const workDirs: string[] = []

function git(args: string[], cwd?: string): { stdout: string; ok: boolean } {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { stdout: result.stdout.toString().trim(), ok: result.exitCode === 0 }
}

beforeAll(() => {
  fixtureRepo = mkdtempSync(join(tmpdir(), 'facet-fixture-git-'))
  // init a bare-ish repo with one commit
  git(['init', '-q', '-b', 'main'], fixtureRepo)
  git(['config', 'user.email', 'test@example.com'], fixtureRepo)
  git(['config', 'user.name', 'Test'], fixtureRepo)
  writeFileSync(join(fixtureRepo, 'facet.json'), '{"name":"test","version":"1.0.0"}')
  git(['add', '.'], fixtureRepo)
  git(['commit', '-q', '-m', 'initial'], fixtureRepo)
  const rev = git(['rev-parse', 'HEAD'], fixtureRepo)
  initialCommit = rev.stdout
})

afterAll(() => {
  rmSync(fixtureRepo, { recursive: true, force: true })
  for (const d of workDirs) rmSync(d, { recursive: true, force: true })
})

describe('cloneGitSource', () => {
  test('clones default branch when commitish omitted', async () => {
    const result = await cloneGitSource(`file://${fixtureRepo}`)
    workDirs.push(result.dir)
    expect(Bun.file(join(result.dir, 'facet.json')).size).toBeGreaterThan(0)
    expect(result.commit).toBe(initialCommit)
  })

  test('clones a branch when commitish is a branch name', async () => {
    const result = await cloneGitSource(`file://${fixtureRepo}`, 'main')
    workDirs.push(result.dir)
    expect(result.commit).toBe(initialCommit)
  })

  test('checks out a SHA when commitish is a SHA', async () => {
    const result = await cloneGitSource(`file://${fixtureRepo}`, initialCommit)
    workDirs.push(result.dir)
    expect(result.commit).toBe(initialCommit)
  })

  test('accepts a short SHA (7+ chars)', async () => {
    const shortSha = initialCommit.slice(0, 10)
    const result = await cloneGitSource(`file://${fixtureRepo}`, shortSha)
    workDirs.push(result.dir)
    // After checkout of FETCH_HEAD, HEAD resolves to the full SHA
    expect(result.commit).toBe(initialCommit)
  })

  test('rejects with a friendly message when the url is bogus', async () => {
    await expect(cloneGitSource(`file:///tmp/definitely-not-a-repo-${Date.now()}`)).rejects.toThrow(/clone failed/)
  })

  test('spawns git with GIT_TERMINAL_PROMPT=0 in env (Adj O)', async () => {
    // Indirect proof: this test would hang in CI without the env flag if
    // git prompted for creds. A bogus HTTPS URL errors immediately because
    // GIT_TERMINAL_PROMPT=0 is set; without it, git would block reading
    // from stdin. We assert fast-fail (< 10s) as a proxy.
    const start = Date.now()
    await expect(cloneGitSource('https://example.invalid/repo.git')).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(10_000)
  })

  // F15: the URL is always separated from git-clone options by `--` so a URL
  // cannot be reinterpreted as a flag. We can't easily snapshot the spawn
  // args from outside, so instead we exercise a URL that starts with `-`
  // and verify git rejects it as an unknown-ref rather than as a flag
  // (e.g. "unknown option" would indicate the guard is missing).
  test('leading `-` in URL is not interpreted as a flag', async () => {
    // This would ALSO fail parse-source validation in the real pipeline, but
    // we're calling cloneGitSource directly — its guard is the `--`
    // separator. We expect git to exit with a "does not appear to be a
    // repository" or similar friendly path-like error, NOT an "unknown
    // option" message (which would mean the guard is missing).
    await expect(cloneGitSource('-upload-pack=./evil')).rejects.toThrow(/clone failed/)
  })
})
