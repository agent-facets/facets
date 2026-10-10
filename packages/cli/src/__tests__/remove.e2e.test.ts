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
import {
  buildFacet,
  forgetConfigurationClaims,
  readJson,
  readLock,
  relockLegacy,
  snapshot,
  writeManifest,
} from './helpers/mcp-project.ts'

/**
 * End-to-end tests for `facet remove` that spawn the compiled `./dist/facet`
 * binary as a subprocess. These cover the CLI surface — argv parsing, help
 * listing + `rm` alias, and usage errors — that the engine unit tests
 * cannot exercise.
 *
 * The full remove transaction (manifest mutation, asset pruning, lockfile
 * regeneration, undeclared-facet failure, multi-name atomicity, and
 * install-failure rollback) is covered end-to-end against real
 * materialization by the engine's `run-remove.test.ts`. The exceptions are
 * the MCP cases at the end of this file, which are about authority: what a
 * removal may delete, and why it sometimes needs content. Those have to hold
 * at the command a user actually runs, not only in the engine.
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

/**
 * Removal and MCP configuration, through the compiled binary.
 *
 * Deletion authority is the machine-local receipt's claims and nothing else;
 * the lockfile's server records can only disqualify an offline removal. And a
 * legacy lockfile has no inventory to carry, so keeping facets under one means
 * resolving them.
 */
describe('facet remove — MCP configuration', () => {
  let projectRoot: string
  let fakeHome: string
  const FILESYSTEM: McpServerDeclaration = { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'] }

  const facetDir = () => join(fakeHome, '.facet')
  const document = () => join(projectRoot, '.test-adapter-mcp.json')
  const servers = () => Object.keys(readJson<{ servers: object }>(document()).servers)
  const run = (args: string[]) => runCli(args, { cwd: projectRoot, env: { HOME: fakeHome, FACET_DIR: facetDir() } })

  async function seed(facets: Record<string, string>): Promise<void> {
    installFakeAdapter(join(facetDir(), 'adapters'), 'test-adapter', { mcp: true })
    writeManifest(projectRoot, { facets })
    const seeded = await run(['install', '--accept-mcp'])
    if (seeded.exitCode !== 0) throw new Error(`seed failed:\n${seeded.stderr}`)
  }

  beforeEach(() => {
    projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-rm-mcp-e2e-')))
    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-rm-mcp-home-')))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('a server shared by identical claims survives until its last witnessed claimant goes', async () => {
    await seed({
      alpha: buildFacet(projectRoot, 'alpha', { servers: { filesystem: FILESYSTEM } }),
      beta: buildFacet(projectRoot, 'beta', { servers: { filesystem: FILESYSTEM } }),
    })

    const first = await run(['remove', 'beta'])

    expect(first.exitCode).toBe(0)
    expect(servers()).toEqual(['filesystem'])
    const lock = readLock(projectRoot)
    expect(Object.keys(lock.facets)).toEqual(['alpha'])
    expect(lock.facets.alpha?.servers).toEqual([
      {
        name: 'filesystem',
        fingerprint: computeMcpServerFingerprint(FILESYSTEM),
        materialization: { kind: 'authored' },
      },
    ])

    const last = await run(['remove', 'alpha'])

    expect(last.exitCode).toBe(0)
    expect(servers()).toEqual([])
  })

  test("a native entry this machine never claimed is not deleted on the lockfile's word", async () => {
    await seed({
      alpha: buildFacet(projectRoot, 'alpha', { servers: { filesystem: FILESYSTEM } }),
      gamma: buildFacet(projectRoot, 'gamma', { skills: ['notes'] }),
    })
    // The lockfile still records alpha's server and the entry is still there,
    // but the receipt no longer claims it.
    forgetConfigurationClaims(facetDir(), projectRoot, 'alpha')
    const before = readFileSync(document(), 'utf8')

    const result = await run(['remove', 'alpha'])

    expect(result.exitCode).toBe(0)
    expect(readLock(projectRoot).facets.alpha).toBeUndefined()
    expect(readFileSync(document(), 'utf8')).toBe(before)
  })

  test('keeping a facet under a legacy lockfile needs its content, and fails intact without it', async () => {
    const alpha = buildFacet(projectRoot, 'alpha', { skills: ['review'] })
    const beta = buildFacet(projectRoot, 'beta', { servers: { filesystem: FILESYSTEM } })
    await seed({ alpha, beta })
    relockLegacy(projectRoot, 0.3)
    const paths = [
      join(projectRoot, 'facets.json'),
      join(projectRoot, 'facets.lock'),
      document(),
      join(projectRoot, '.test-adapter', 'skills', 'review.md'),
    ]
    const before = snapshot(paths)
    // beta stays, and its content is unavailable.
    renameSync(join(projectRoot, beta), join(projectRoot, `${beta}.away`))

    const failed = await run(['remove', 'alpha'])

    expect(failed.exitCode).toBe(1)
    // Why a removal needed content at all, beside — not instead of — the cause.
    expect(failed.stderr).toContain('facets.lock v0.3 records no MCP server inventory')
    expect(failed.stderr).toContain('to write v0.4; that resolution failed')
    expect(failed.stderr).toContain('code=LOCAL_RESOLVE_FAILED')
    expect(failed.stderr).toContain('nothing was written')
    expect(snapshot(paths)).toEqual(before)

    // With the content back, the same removal migrates.
    renameSync(join(projectRoot, `${beta}.away`), join(projectRoot, beta))
    const recovered = await run(['remove', 'alpha'])

    expect(recovered.exitCode).toBe(0)
    const lock = readLock(projectRoot)
    expect(lock.lockfileVersion).toBe(0.4)
    expect(Object.keys(lock.facets)).toEqual(['beta'])
    expect(lock.facets.beta?.servers).toEqual([
      {
        name: 'filesystem',
        fingerprint: computeMcpServerFingerprint(FILESYSTEM),
        materialization: { kind: 'authored' },
      },
    ])
    expect(existsSync(join(projectRoot, '.test-adapter', 'skills', 'review.md'))).toBe(false)
    expect(servers()).toEqual(['filesystem'])
  })

  test('removing the last facet of a legacy project needs no content', async () => {
    const alpha = buildFacet(projectRoot, 'alpha', { servers: { filesystem: FILESYSTEM } })
    await seed({ alpha })
    relockLegacy(projectRoot, 0.2)
    rmSync(join(projectRoot, alpha), { recursive: true, force: true })

    const result = await run(['remove', 'alpha'])

    expect(result.exitCode).toBe(0)
    expect(readLock(projectRoot)).toEqual({ lockfileVersion: 0.4, facets: {} })
    // The receipt witnessed this entry, so it — and only it — may be deleted.
    expect(servers()).toEqual([])
  })
})
