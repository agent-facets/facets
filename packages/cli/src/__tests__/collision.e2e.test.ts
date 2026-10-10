import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeMcpServerFingerprint, type McpServerDeclaration } from '@agent-facets/protocol'
import { spawnCli } from './helpers/cli-process.ts'
import { installFakeAdapter } from './helpers/fake-adapter.ts'
import { buildFacet, readLock, receiptFile, relockLegacy, snapshot } from './helpers/mcp-project.ts'

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

/**
 * Frozen checks that a `0.4` lockfile lets the binary make from metadata
 * alone, before anything is fetched or built.
 *
 * Each refusal below runs with the facet sources moved away. A refusal that
 * still arrives — naming the right contributions — was decided without them.
 */
describe('frozen checks over the locked server inventory', () => {
  const STDIO: McpServerDeclaration = { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'] }
  const HTTP: McpServerDeclaration = { type: 'http', url: 'https://other.example.com/mcp' }

  /** Ink wraps piped output at the terminal width; compare words, not line breaks. */
  const words = (text: string) => text.replace(/\s+/g, ' ')

  /** Every file a refused run must leave exactly as it found it. */
  function projectFiles(): string[] {
    return [
      join(projectRoot, 'facets.json'),
      join(projectRoot, 'facets.lock'),
      join(projectRoot, '.test-adapter-mcp.json'),
      receiptFile(join(fakeHome, '.facet'), projectRoot),
    ]
  }

  /** Move every facet source out of reach, returning a function that restores them. */
  function unplugSources(sources: readonly string[]): () => void {
    const moved = sources.map((source) => {
      const from = join(projectRoot, source)
      const to = `${from}.away`
      renameSync(from, to)
      return { from, to }
    })
    return () => {
      for (const { from, to } of moved) renameSync(to, from)
    }
  }

  async function seed(manifest: unknown): Promise<void> {
    installFakeAdapter(adaptersDir, 'test-adapter', { mcp: true })
    writeManifest(manifest)
    const seeded = await runCli(['install', '--accept-mcp'])
    if (seeded.exitCode !== 0) throw new Error(`seed failed:\n${seeded.stderr}`)
  }

  test('asset and server collisions and stale intent are reported together, by fingerprint', async () => {
    const alpha = buildFacet(projectRoot, 'alpha', { skills: ['review'], servers: { filesystem: STDIO } })
    const beta = buildFacet(projectRoot, 'beta', { skills: ['other'], servers: { filesystem: HTTP } })
    await seed({
      manifestVersion: 0.2,
      facets: { alpha, beta: { source: beta, materialization: { servers: { filesystem: { kind: 'omitted' } } } } },
    })
    // The manifest now withdraws the omission, aliases beta's skill onto
    // alpha's, and names a server alpha never declared.
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: alpha, materialization: { servers: { gone: { kind: 'omitted' } } } },
        beta: { source: beta, materialization: { skills: { other: { kind: 'aliased', as: 'review' } } } },
      },
    })
    const before = snapshot(projectFiles())
    unplugSources([alpha, beta])

    const result = await runCli(['install', '--frozen-lockfile'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('code=LOCKED_MATERIALIZATION_COLLISION')
    expect(result.stderr).toContain('before fetching anything')
    expect(result.stderr).toContain('project skills and commands — "review" is claimed by:')
    expect(result.stderr).toContain('MCP servers — "filesystem" is claimed by:')
    expect(result.stderr).toContain(`locked fingerprint ${computeMcpServerFingerprint(STDIO)}`)
    expect(result.stderr).toContain(`locked fingerprint ${computeMcpServerFingerprint(HTTP)}`)
    expect(result.stderr).toContain('server "gone"')
    expect(result.stderr).toContain('without --frozen-lockfile')
    // Metadata only: no declaration value was read, so none can be shown.
    const output = `${result.stdout}${result.stderr}`
    for (const value of ['npx', 'server-filesystem', 'other.example.com']) expect(output).not.toContain(value)
    expect(snapshot(projectFiles())).toEqual(before)
  })

  test('dropping a recorded alias is drift, not a silent keep', async () => {
    const alpha = buildFacet(projectRoot, 'alpha', { servers: { filesystem: STDIO } })
    await seed({
      manifestVersion: 0.2,
      facets: { alpha: { source: alpha, materialization: { servers: { filesystem: { kind: 'aliased', as: 'fs' } } } } },
    })
    writeManifest({ manifestVersion: 0.2, facets: { alpha } })
    const before = snapshot(projectFiles())
    unplugSources([alpha])

    const result = await runCli(['install', '--frozen-lockfile'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('code=LOCKFILE_DRIFT')
    expect(words(result.stdout)).toContain(
      'alpha: server "filesystem": facets.json says authored, lockfile says aliased to "fs"',
    )
    expect(snapshot(projectFiles())).toEqual(before)
  })

  test.each([
    0.2, 0.3,
  ] as const)('a server override under %p is refused for capability, then recovers', async (version) => {
    const alpha = buildFacet(projectRoot, 'alpha', { servers: { filesystem: STDIO } })
    await seed({ facets: { alpha } })
    relockLegacy(projectRoot, version)
    const omitted = {
      manifestVersion: 0.2,
      facets: { alpha: { source: alpha, materialization: { servers: { filesystem: { kind: 'omitted' } } } } },
    }
    writeManifest(omitted)
    const before = snapshot(projectFiles())
    const replug = unplugSources([alpha])

    const refused = await runCli(['install', '--frozen-lockfile'])

    expect(refused.exitCode).toBe(1)
    // The capability the choice needs, and separately the format a normal
    // install would write — two different version numbers, both stated.
    expect(words(refused.stdout)).toContain(
      `alpha: lockfile v${version} cannot record materialization overrides (needs v0.4)`,
    )
    expect(refused.stderr).toContain('code=LOCKFILE_DRIFT')
    expect(refused.stderr).toContain('writes the current v0.4 format')
    expect(snapshot(projectFiles())).toEqual(before)

    // Without the override, the legacy lockfile still reproduces — and is not
    // migrated by a frozen run.
    replug()
    writeManifest({ facets: { alpha } })
    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    const reproduced = await runCli(['install', '--frozen-lockfile'])
    expect(reproduced.exitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)

    // The remedy the refusal named: a normal install records the choice in 0.4.
    writeManifest(omitted)
    const migrated = await runCli(['install'])
    expect(migrated.exitCode).toBe(0)
    const lock = readLock(projectRoot)
    expect(lock.lockfileVersion).toBe(0.4)
    expect(lock.facets.alpha?.servers).toEqual([
      { name: 'filesystem', fingerprint: computeMcpServerFingerprint(STDIO), materialization: { kind: 'omitted' } },
    ])
  })

  test('an asset-only override under 0.2 needs only 0.3, while the remedy still writes 0.4', async () => {
    const alpha = buildFacet(projectRoot, 'alpha', { skills: ['review'] })
    await seed({ facets: { alpha } })
    relockLegacy(projectRoot, 0.2)
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: alpha, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    unplugSources([alpha])

    const result = await runCli(['install', '--frozen-lockfile'])

    expect(result.exitCode).toBe(1)
    expect(words(result.stdout)).toContain('alpha: lockfile v0.2 cannot record materialization overrides (needs v0.3)')
    expect(result.stderr).toContain('writes the current v0.4 format')
  })

  test('same-integrity server metadata that disagrees with content is reported, not repaired', async () => {
    const alpha = buildFacet(projectRoot, 'alpha', { servers: { filesystem: STDIO } })
    await seed({ facets: { alpha } })
    const tampered = `sha256:${'0'.repeat(64)}`
    const lock = readLock(projectRoot)
    const record = lock.facets.alpha?.servers?.[0]
    if (record === undefined) throw new Error('seed recorded no server')
    record.fingerprint = tampered
    writeFileSync(join(projectRoot, 'facets.lock'), `${JSON.stringify(lock, null, 2)}\n`)
    const before = snapshot(projectFiles())

    // A normal install: content is fetched and verified, and still the
    // mismatch is refused rather than silently regenerated.
    const result = await runCli(['install'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('code=RECONCILE_SERVER_FINGERPRINT')
    // Escaped literals: a facet controls these names, so they are quoted.
    expect(result.stderr).toContain('facets.lock records a different fingerprint for server "filesystem" in "alpha"')
    expect(result.stderr).toContain(`locked:   "${tampered}"`)
    expect(result.stderr).toContain(`verified: "${computeMcpServerFingerprint(STDIO)}"`)
    expect(result.stderr).toContain('Re-running will not repair it')
    for (const value of ['npx', 'server-filesystem']) expect(result.stderr).not.toContain(value)
    expect(snapshot(projectFiles())).toEqual(before)
  })
})
