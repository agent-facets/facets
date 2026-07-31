import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnCli } from './helpers/cli-process.ts'
import { installFakeAdapter } from './helpers/fake-adapter.ts'

/**
 * End-to-end coverage for cross-facet name collisions, driving the
 * compiled binary with piped stdio.
 *
 * The in-process command tests fake TTY-ness by redefining stream
 * properties. That proves the branch, but not the thing that actually
 * matters here: a real subprocess with pipes has no TTY on either
 * stream, so this is the only place the true non-interactive path — the
 * one CI hits — is exercised end to end. It is also where a regression
 * would be most damaging, because the failure mode is a hang rather than
 * an error.
 */

let projectRoot: string
let fakeHome: string
let adaptersDir: string

const runCli = (args: string[]) =>
  spawnCli(args, { cwd: projectRoot, env: { HOME: fakeHome, FACET_DIR: join(fakeHome, '.facet') } })

/**
 * A facet contributing one skill.
 *
 * The body names the FACET, not just the skill. Two facets colliding on one
 * skill name previously wrote byte-identical content, so a test asserting the
 * surviving file existed could not tell an omitted write from an overwriting
 * one — which is the exact bug omission is supposed to prevent.
 */
function buildFixture(name: string, skill: string): string {
  const repo = realpathSync(mkdtempSync(join(projectRoot, 'fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({ name, version: '0.1.0', skills: { [skill]: { description: `${skill} skill` } } }),
  )
  mkdirSync(join(repo, `skills/${skill}`), { recursive: true })
  writeFileSync(join(repo, `skills/${skill}/SKILL.md`), `# ${skill}\n\nowned by ${name}\n`)
  return `./${repo.split('/').pop()}`
}

function writeManifest(value: unknown): void {
  writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify(value, null, 2))
}

beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-collision-e2e-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-collision-home-')))
  adaptersDir = join(fakeHome, '.facet', 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('collisions — non-interactive install', () => {
  test('fails with the full report, a non-zero exit, and no writes', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const alpha = buildFixture('alpha', 'planning')
    const beta = buildFixture('beta', 'planning')
    writeManifest({ facets: { alpha, beta } })
    const before = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    const result = await runCli(['install'])

    expect(result.exitCode).toBe(1)
    // The complete report reaches stderr, which is what survives `2>&1`
    // into a CI log when stdout is a discarded live region.
    expect(result.stderr).toContain('facets["alpha"].materialization.skills["planning"]')
    expect(result.stderr).toContain('facets["beta"].materialization.skills["planning"]')
    expect(result.stderr).toContain('"kind": "aliased"')
    expect(result.stderr).toContain('"kind": "omitted"')
    expect(result.stderr).toContain('NOT changed')
    expect(result.stderr).toContain('code=MATERIALIZATION_COLLISION')

    // No winner anywhere in the output.
    expect(result.stderr.toLowerCase()).not.toContain('winner')
    expect(result.stderr.toLowerCase()).not.toContain('preferred')

    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    expect(existsSync(join(projectRoot, '.test-adapter'))).toBe(false)
  })

  test('recorded intent installs both assets without any prompt', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const alpha = buildFixture('alpha', 'planning')
    const beta = buildFixture('beta', 'planning')
    writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha,
        beta: { source: beta, materialization: { skills: { planning: { kind: 'aliased', as: 'beta-planning' } } } },
      },
    })

    const result = await runCli(['install'])

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)
    expect(existsSync(join(projectRoot, '.test-adapter/skills/beta-planning.md'))).toBe(true)
  })

  test('an omitted asset is never written but stays in the lockfile', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const alpha = buildFixture('alpha', 'planning')
    const beta = buildFixture('beta', 'planning')
    writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha,
        beta: { source: beta, materialization: { skills: { planning: { kind: 'omitted' } } } },
      },
    })

    const result = await runCli(['install'])

    expect(result.exitCode).toBe(0)
    const written = join(projectRoot, '.test-adapter/skills/planning.md')
    expect(existsSync(written)).toBe(true)
    // The surviving file belongs to alpha. Asserting only that it EXISTS
    // could not distinguish "beta was omitted" from "beta overwrote alpha".
    const content = readFileSync(written, 'utf8')
    expect(content).toContain('owned by alpha')
    expect(content).not.toContain('owned by beta')
    const lockfile = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lockfile.facets.beta.assets[0].materialization).toEqual({ kind: 'omitted' })
  })
})

describe('collisions — frozen install', () => {
  test('reports rather than prompting, and writes nothing', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const alpha = buildFixture('alpha', 'planning')
    const beta = buildFixture('beta', 'planning')
    writeManifest({ facets: { alpha, beta } })

    const result = await runCli(['install', '--frozen-lockfile'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('install failed')
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    expect(existsSync(join(projectRoot, '.test-adapter'))).toBe(false)
  })
})

describe('collisions — failure ordering', () => {
  test('an unusable adapter is reported before any collision choice is requested', async () => {
    // Adapter compatibility is a precondition of materializing anything,
    // so asking a user to arbitrate names first would be asking them to
    // decide something that cannot be applied either way.
    const dir = join(adaptersDir, 'broken-adapter')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'adapter.js'), 'export default { name: "broken-adapter", apiVersion: "0.0" }\n')

    const alpha = buildFixture('alpha', 'planning')
    const beta = buildFixture('beta', 'planning')
    writeManifest({ facets: { alpha, beta } })

    const result = await runCli(['install'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain('MATERIALIZATION_COLLISION')
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })
})
