import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION, planSingleFileInstall, planSingleFileRemoval } from '@agent-facets/adapter'
import type { McpConsentPolicy } from '../mcp/consent.ts'
import { receiptPath } from '../receipt.ts'
import { runRemove } from '../remove/index.ts'
import { runInstall } from '../run-install.ts'
import type { MutationInteractions, RunInstallResult, StageEvent } from '../types.ts'
import { type RecordingMcpOptions, recordingMcpCapability } from './helpers/mcp-adapter.ts'

/**
 * What a run REPORTS about MCP configuration: per-facet classification,
 * separate summary counts, outcome events, and what those surfaces are
 * allowed to carry.
 *
 * Kept apart from `mcp-install.test.ts`, which is about ordering — what has
 * and has not happened when a run refuses. These tests almost all succeed;
 * the subject is the account the operation gives of itself afterwards.
 */

let projectRoot: string
let originalCwd: string
let originalFacetDir: string | undefined
let fakeHome: string

const STDIO = { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'], env: { TOKEN: 'hunter2' } }
const OTHER = { type: 'http', url: 'https://example.test/mcp' }
const ACCEPT: McpConsentPolicy = { kind: 'preapproved' }

interface TestAdapter {
  adapter: Adapter
  documentPath: string
}

function mcpAdapter(name: string, options: RecordingMcpOptions = {}): TestAdapter {
  const baseDir = () => join(projectRoot, `.${name}`)
  const file = (type: string, assetName: string) => join(baseDir(), `${type}s`, `${assetName}.md`)
  const document = () => join(baseDir(), 'mcp.json')
  const mcp = recordingMcpCapability(document, options)
  return {
    get documentPath() {
      return document()
    },
    adapter: {
      name,
      apiVersion: ADAPTER_API_VERSION,
      mcpServers: mcp.capability,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      assets: {
        async planInstall(request) {
          return planSingleFileInstall(
            { file: file(request.assetType, request.name), boundary: baseDir() },
            request.content,
            request.metadata as Record<string, unknown>,
          )
        },
        async planRemoval(request) {
          return planSingleFileRemoval({ file: file(request.assetType, request.name), boundary: baseDir() })
        },
      },
    },
  }
}

function serverFixture(facet: string, server: string, declaration: unknown, version = '1.0.0'): string {
  const dir = join(projectRoot, 'vendor', facet)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'facet.json'), JSON.stringify({ name: facet, version, servers: { [server]: declaration } }))
  return `./vendor/${facet}`
}

function skillFixture(facet: string, skill: string): string {
  const dir = join(projectRoot, 'vendor', facet)
  mkdirSync(join(dir, `skills/${skill}`), { recursive: true })
  writeFileSync(
    join(dir, 'facet.json'),
    JSON.stringify({ name: facet, version: '1.0.0', skills: { [skill]: { description: `${skill} skill` } } }),
  )
  writeFileSync(join(dir, `skills/${skill}/SKILL.md`), `# ${skill} from ${facet}\n`)
  return `./vendor/${facet}`
}

function writeManifest(value: unknown): void {
  writeFileSync(join(projectRoot, 'facets.json'), `${JSON.stringify(value, null, 2)}\n`)
}

/** Run an install, collecting every stage event it emits. */
async function install(
  options: MutationInteractions & { adapters: Adapter[] },
): Promise<{ result: RunInstallResult; events: StageEvent[] }> {
  const { adapters, ...interactions } = options
  const events: StageEvent[] = []
  const result = await runInstall({
    projectRoot,
    adapters,
    operation: { kind: 'reproduce', frozen: false, mcpConsent: ACCEPT, ...interactions },
    onStage: (event) => events.push(event),
  })
  return { result, events }
}

/** Narrow to a successful run. */
function succeeded(result: RunInstallResult): Extract<RunInstallResult, { ok: true }> {
  if (!result.ok) expect.unreachable()
  return result
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-mcp-out-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-mcp-out-home-')))
  process.env.FACET_DIR = join(fakeHome, '.facet')
  process.chdir(projectRoot)
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('mcp outcomes — a server-only facet reports its work', () => {
  test('a first install reports one configuration added and zero assets', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.summary.facets.installed).toBe(1)
    expect(success.summary.textAssets.written).toBe(0)
    expect(success.summary.mcp.configurations.added).toBe(1)
    expect(success.perFacet).toEqual([{ kind: 'installed', name: 'alpha', version: '1.0.0' }])
    expect(success.mcp.configurations).toEqual([
      {
        kind: 'active',
        adapter: 'rec',
        effectiveName: 'filesystem',
        claimants: ['alpha'],
        status: 'added',
        takenOver: false,
      },
    ])
  })

  test('a second install with nothing changed is unchanged, not repaired', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.perFacet).toEqual([{ kind: 'unchanged', name: 'alpha', version: '1.0.0' }])
    expect(success.summary.mcp.configurations).toEqual({
      added: 0,
      updated: 0,
      repaired: 0,
      unchanged: 1,
      removed: 0,
    })
    expect(success.mcp.dispositions).toEqual([
      { kind: 'authored', facet: 'alpha', authoredName: 'filesystem', change: 'unchanged' },
    ])
  })

  test('native drift at an approved identity is repaired', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    // Someone deleted the tool's configuration. The declaration this machine
    // approved has not changed — only the file has.
    rmSync(rec.documentPath, { force: true })

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.perFacet).toEqual([{ kind: 'repaired', name: 'alpha', version: '1.0.0' }])
    expect(success.summary.mcp.configurations.repaired).toBe(1)
    // The project asked for exactly what it asked for last time.
    expect(success.mcp.dispositions[0]?.change).toBe('unchanged')
  })
})

describe('mcp outcomes — intent changes are updates, not repairs', () => {
  test('aliasing a server at an unchanged facet version is updated', async () => {
    const source = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: source } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source, materialization: { servers: { filesystem: { kind: 'aliased', as: 'fs' } } } } },
    })

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.perFacet).toEqual([{ kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' }])
    expect(success.summary.mcp.declarations).toEqual({ aliased: 1, omitted: 0 })
    expect(success.mcp.dispositions).toEqual([
      { kind: 'aliased', facet: 'alpha', authoredName: 'filesystem', effectiveName: 'fs', change: 'updated' },
    ])
  })

  test('omitting a previously configured server is updated and removes the entry', async () => {
    const source = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: source } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source, materialization: { servers: { filesystem: { kind: 'omitted' } } } } },
    })

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.perFacet).toEqual([{ kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' }])
    expect(success.summary.mcp.declarations).toEqual({ aliased: 0, omitted: 1 })
    expect(success.summary.mcp.configurations.removed).toBe(1)
    expect(JSON.parse(readFileSync(rec.documentPath, 'utf8'))).toEqual({})
  })

  test('an omission that was already there stays unchanged', async () => {
    const source = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source, materialization: { servers: { filesystem: { kind: 'omitted' } } } } },
    })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    // Nothing was ever configured, so there is nothing to have changed.
    expect(success.perFacet).toEqual([{ kind: 'unchanged', name: 'alpha', version: '1.0.0' }])
    expect(success.mcp.dispositions).toEqual([
      { kind: 'omitted', facet: 'alpha', authoredName: 'filesystem', change: 'unchanged' },
    ])
  })
})

describe('mcp outcomes — a first declaration on an existing facet', () => {
  /** Republish the same facet version, now declaring a server. */
  function addServerToInstalledFacet(): string {
    return serverFixture('alpha', 'filesystem', STDIO)
  }

  test('a proven first declaration is new intent, so the facet is updated', async () => {
    // Installed first WITHOUT a server: the receipt records the facet and no
    // claim for `filesystem`, which is what proves the declaration is new.
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    addServerToInstalledFacet()
    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.mcp.dispositions).toEqual([
      { kind: 'authored', facet: 'alpha', authoredName: 'filesystem', change: 'introduced' },
    ])
    expect(success.perFacet).toEqual([{ kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' }])
  })

  test('a proven first declaration whose entry already matches is still updated', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    // Someone configured the identical server by hand, so reconciliation
    // writes nothing at all. The project's intent changed regardless.
    mkdirSync(join(projectRoot, '.rec'), { recursive: true })
    writeFileSync(rec.documentPath, `${JSON.stringify({ filesystem: STDIO }, null, 2)}\n`)

    addServerToInstalledFacet()
    const { result } = await install({ adapters: [rec.adapter], mcpConsent: { kind: 'preapproved' } })
    const success = succeeded(result)

    expect(success.mcp.dispositions[0]?.change).toBe('introduced')
    expect(success.perFacet).toEqual([{ kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' }])
  })

  test('a first declaration the receipt cannot speak to is not reported as new intent', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    // No receipt at all: the absence of a claim is silence, not proof.
    rmSync(receiptPath(projectRoot), { force: true })

    addServerToInstalledFacet()
    const { result } = await install({ adapters: [rec.adapter], mcpConsent: { kind: 'preapproved' } })
    const success = succeeded(result)

    expect(success.mcp.dispositions).toEqual([
      { kind: 'authored', facet: 'alpha', authoredName: 'filesystem', change: 'unrecorded' },
    ])
    expect(success.perFacet).toEqual([{ kind: 'repaired', name: 'alpha', version: '1.0.0' }])
  })
})

describe('mcp outcomes — evidence this machine does not have', () => {
  test('a receipt that predates configuration claims reports intent as unwitnessed', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    // Rewrite the receipt at the version that cannot express a claim.
    const receipt = JSON.parse(readFileSync(receiptPath(projectRoot), 'utf8'))
    receipt.version = 0.3
    for (const facet of Object.values(receipt.facets) as Array<Record<string, unknown>>) {
      delete facet.configurations
      delete facet.integrity
    }
    writeFileSync(receiptPath(projectRoot), `${JSON.stringify(receipt, null, 2)}\n`)

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    // It does not claim the declaration is new, and it does not claim it is
    // unchanged. It says it cannot tell.
    expect(success.mcp.dispositions).toEqual([
      { kind: 'authored', facet: 'alpha', authoredName: 'filesystem', change: 'unwitnessed' },
    ])
    // And an unwitnessed intent never fabricates an update on its own.
    expect(success.perFacet).toEqual([{ kind: 'unchanged', name: 'alpha', version: '1.0.0' }])
  })
})

describe('mcp outcomes — takeover', () => {
  test('an equivalent untracked entry is adopted as unchanged plus a takeover', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    // Forget the identity while leaving the file: the entry is now untracked
    // AND already exactly right.
    rmSync(receiptPath(projectRoot), { force: true })

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.perFacet).toEqual([{ kind: 'unchanged', name: 'alpha', version: '1.0.0' }])
    expect(success.summary.mcp.configurations.unchanged).toBe(1)
    expect(success.summary.mcp.takeovers.accepted).toBe(1)
    expect(success.mcp.configurations[0]).toMatchObject({ status: 'unchanged', takenOver: true })
  })

  test('a divergent untracked entry is repaired plus a takeover', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    mkdirSync(join(projectRoot, '.rec'), { recursive: true })
    writeFileSync(rec.documentPath, `${JSON.stringify({ filesystem: OTHER }, null, 2)}\n`)

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.summary.mcp.configurations.repaired).toBe(1)
    expect(success.summary.mcp.takeovers.accepted).toBe(1)
    expect(success.mcp.configurations[0]).toMatchObject({ status: 'repaired', takenOver: true })
  })
})

describe('mcp outcomes — counting', () => {
  test('every adapter contributes its own reconciliation', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const one = mcpAdapter('one')
    const two = mcpAdapter('two')

    const { result } = await install({ adapters: [one.adapter, two.adapter] })
    const success = succeeded(result)

    // The same unit as text assets, which also count per adapter.
    expect(success.summary.mcp.configurations.added).toBe(2)
    expect(success.mcp.configurations.map((o) => o.adapter)).toEqual(['one', 'two'])
  })

  test('two facets declaring the same server both claim the one configuration', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: serverFixture('beta', 'filesystem', STDIO),
      },
    })
    const rec = mcpAdapter('rec')

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.summary.mcp.configurations.added).toBe(1)
    expect(success.mcp.configurations[0]).toMatchObject({ claimants: ['alpha', 'beta'] })
    // Reconciling a shared identity is work on behalf of every claimant, so
    // neither facet is reported as having had nothing done for it.
    expect(success.perFacet.map((o) => o.kind)).toEqual(['installed', 'installed'])
  })

  test('an entry someone already deleted is not counted as a removal', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: skillFixture('beta', 'review'),
      },
    })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    // The user removed the entry by hand before asking to remove the facet.
    writeFileSync(rec.documentPath, '{}\n')
    rmSync(join(projectRoot, 'vendor/alpha'), { recursive: true, force: true })

    const removed = await runRemove({ projectRoot, names: ['alpha'], adapters: [rec.adapter] })
    if (!removed.ok) expect.unreachable()

    expect(removed.install.summary.mcp.configurations.removed).toBe(0)
    expect(removed.install.mcp.configurations).toEqual([
      {
        kind: 'obsolete',
        adapter: 'rec',
        effectiveName: 'filesystem',
        previousClaimants: ['alpha'],
        status: 'already-absent',
      },
    ])
  })

  test('removing the last claimant reports the removal', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: skillFixture('beta', 'review'),
      },
    })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)
    rmSync(join(projectRoot, 'vendor/alpha'), { recursive: true, force: true })

    const removed = await runRemove({ projectRoot, names: ['alpha'], adapters: [rec.adapter] })
    if (!removed.ok) expect.unreachable()

    expect(removed.install.summary.mcp.configurations.removed).toBe(1)
    expect(removed.install.mcp.configurations[0]).toMatchObject({ kind: 'obsolete', status: 'removed' })
  })
})

describe('mcp outcomes — events', () => {
  test('consent and configuration events bracket the work', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    const { events } = await install({ adapters: [rec.adapter] })
    const kinds = events.map((event) => event.kind)

    expect(kinds).toContain('mcp-consent-required')
    expect(kinds).toContain('mcp-consent-accepted')
    // Committed outcomes come after the lockfile write, because until then
    // the configuration is still a candidate for rollback.
    expect(kinds.indexOf('mcp-configured')).toBeGreaterThan(kinds.indexOf('lockfile-write'))
    expect(kinds.indexOf('mcp-consent-accepted')).toBeLessThan(kinds.indexOf('mcp-configured'))
  })

  test('a preapproved run says so', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    const { events, result } = await install({ adapters: [rec.adapter] })

    const accepted = events.find((event) => event.kind === 'mcp-consent-accepted')
    expect(accepted).toEqual({ kind: 'mcp-consent-accepted', via: 'preapproved' })
    const success = succeeded(result)
    if (success.mcp.consent.kind !== 'accepted') expect.unreachable()
    expect(success.mcp.consent.via).toBe('preapproved')
  })

  test('a rolled-back run announces no configuration at all', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const first = mcpAdapter('first')
    // The second adapter writes nothing and fails, AFTER the first has already
    // written its document — so this is a real rollback, not a refusal before
    // the first mutation.
    const second = mcpAdapter('second', {
      failApply: { code: 'io-failed', path: '/nope', message: 'disk on fire' },
    })

    const { result, events } = await install({ adapters: [first.adapter, second.adapter] })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MCP_APPLY_FAILED')
    expect(result.rollback.kind).toBe('complete')
    expect(events.map((event) => event.kind)).not.toContain('mcp-configured')
    // The restore put the first adapter's document back to not existing.
    expect(existsSync(first.documentPath)).toBe(false)
  })

  test('a declined request is reported as declined and carries the identities', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    const { result, events } = await install({
      adapters: [rec.adapter],
      mcpConsent: { kind: 'interactive', resolve: async () => ({ kind: 'declined' }) },
    })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MCP_CONSENT_DECLINED') expect.unreachable()
    expect(result.failure.request.declarations).toEqual([
      { effectiveName: 'filesystem', claimants: ['alpha'], standing: { kind: 'unknown-identity' } },
    ])
    expect(events.map((event) => event.kind)).toContain('mcp-consent-declined')
  })

  test('an asset takeover is announced and then accepted', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    mkdirSync(join(projectRoot, '.rec', 'skills'), { recursive: true })
    writeFileSync(join(projectRoot, '.rec', 'skills', 'review.md'), '# hand written\n')

    const { events } = await install({
      adapters: [rec.adapter],
      resolveAssetTakeover: async () => ({ kind: 'continue' }),
    })

    const kinds = events.map((event) => event.kind)
    expect(kinds).toContain('asset-takeover-required')
    expect(kinds).toContain('asset-takeover-accepted')
    expect(kinds).not.toContain('asset-takeover-cancelled')
  })

  test('a cancelled asset takeover is announced as cancelled', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    mkdirSync(join(projectRoot, '.rec', 'skills'), { recursive: true })
    writeFileSync(join(projectRoot, '.rec', 'skills', 'review.md'), '# hand written\n')

    const { events } = await install({
      adapters: [rec.adapter],
      resolveAssetTakeover: async () => ({ kind: 'cancelled' }),
    })

    const kinds = events.map((event) => event.kind)
    expect(kinds).toContain('asset-takeover-cancelled')
    expect(kinds).not.toContain('asset-takeover-accepted')
  })
})

describe('mcp outcomes — what routine surfaces carry', () => {
  const SECRETS = ['npx', 'server-filesystem', 'hunter2', 'TOKEN', 'example.test']

  test('outcomes and events name identities, not declarations', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    const { result, events } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    const reported = JSON.stringify({ mcp: success.mcp, summary: success.summary, events })
    for (const secret of SECRETS) {
      expect(reported).not.toContain(secret)
    }
    // What they DO carry is enough to report the work.
    expect(reported).toContain('filesystem')
  })

  test('the approval surface still receives the exact declaration', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    let shown = ''
    const { result } = await install({
      adapters: [rec.adapter],
      mcpConsent: {
        kind: 'interactive',
        resolve: async (request) => {
          shown = JSON.stringify(request)
          return { kind: 'approved' }
        },
      },
    })

    expect(result.ok).toBe(true)
    // A user cannot authorize a command they were not shown.
    for (const secret of SECRETS.filter((s) => s !== 'example.test')) {
      expect(shown).toContain(secret)
    }
  })
})

describe('mcp outcomes — stale server intent', () => {
  test('a pruned server override is reported and makes the facet updated', async () => {
    const source = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: source } })
    const rec = mcpAdapter('rec')
    expect((await install({ adapters: [rec.adapter] })).result.ok).toBe(true)

    // An override naming a declaration the facet does not publish.
    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source, materialization: { servers: { gone: { kind: 'omitted' } } } } },
    })

    const { result } = await install({ adapters: [rec.adapter] })
    const success = succeeded(result)

    expect(success.mcp.prunedIntent).toEqual([{ facet: 'alpha', authoredName: 'gone' }])
    // `facets.json` is materially different afterwards, so the facet is not
    // unchanged — even though nothing about its declarations moved.
    expect(success.perFacet).toEqual([{ kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' }])
  })
})
