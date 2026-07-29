import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'

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

let projectRoot: string
let fakeHome: string
let adaptersDir: string

async function runCli(args: string[]): Promise<ExecResult> {
  const proc = Bun.spawn([CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    // Closed stdin: nothing can answer a prompt, so a command that tried
    // to open one would hang here rather than fail.
    stdin: 'ignore',
    cwd: projectRoot,
    env: { ...process.env, HOME: fakeHome, FACET_DIR: join(fakeHome, '.facet') },
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: await proc.exited }
}

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

/**
 * A dependency-free adapter bundle.
 *
 * The in-process command tests import the real `@agent-facets/adapter`
 * helpers, but a bundle written into a temp directory and loaded by the
 * compiled binary has no workspace `node_modules` to resolve them from.
 * Since these tests are about which assets get written under which
 * names — not about front-matter assembly, which the adapter suite
 * covers — plain `node:fs` is the honest dependency here.
 */
function installFakeAdapter(name: string): void {
  const dir = join(adaptersDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'adapter.js'),
    `
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

function path(type, name) { return join(process.cwd(), '.${name}', type + 's', name + '.md') }

export default {
  name: '${name}',
  apiVersion: '${ADAPTER_API_VERSION}',
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(req) {
    const file = path(req.assetType, req.name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, req.content)
    return { ok: true, primaryPath: file }
  },
  async readAsset(req) {
    const file = path(req.assetType, req.name)
    if (!existsSync(file)) return { ok: false, failure: { code: 'not-found' } }
    const content = readFileSync(file, 'utf8')
    return { ok: true, asset: req.assetType === 'skill'
      ? { assetType: 'skill', content, metadata: {}, companions: {} }
      : { assetType: req.assetType, content, metadata: {} } }
  },
  async deleteAsset(req) {
    const file = path(req.assetType, req.name)
    const existed = existsSync(file)
    rmSync(file, { force: true })
    return { ok: true, existed, deletedPaths: existed ? [file] : [] }
  },
}
`,
  )
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
    installFakeAdapter('test-adapter')
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
    installFakeAdapter('test-adapter')
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
    installFakeAdapter('test-adapter')
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
    installFakeAdapter('test-adapter')
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
