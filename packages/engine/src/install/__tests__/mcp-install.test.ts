import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import {
  ADAPTER_API_VERSION,
  ADAPTER_API_VERSION_ASSETS_ONLY,
  deleteAssetFile,
  installAssetFile,
  readAssetFile,
} from '@agent-facets/adapter'
import type { AssetTakeoverRequest } from '../asset-takeover.ts'
import type { McpConsentRequest } from '../mcp/consent.ts'
import { receiptPath } from '../receipt.ts'
import { runRemove } from '../remove/index.ts'
import { runInstall } from '../run-install.ts'
import { assetIdentity, type RunInstallOptions } from '../types.ts'
import { type RecordingMcpOptions, recordingMcpCapability } from './helpers/mcp-adapter.ts'

/**
 * MCP configuration through the real install pipeline: support, preparation,
 * consent, application, rollback, frozen reproduction, and offline removal.
 *
 * The properties under test are almost all ORDERING properties — what has and
 * has not happened at the moment a run refuses. So nearly every failing case
 * also asserts what is on disk, and the successful ones assert what is not.
 */

let projectRoot: string
let originalCwd: string
let originalFacetDir: string | undefined
let fakeHome: string

const STDIO = { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'] }
const HTTP = { type: 'http', url: 'https://example.test/mcp' }
const ACCEPT: RunInstallOptions['mcpConsent'] = { kind: 'preapproved' }

interface TestAdapter {
  adapter: Adapter
  io: string[]
  mcpCalls: string[]
  documentPath: string
}

/** A `0.2` adapter with a working MCP capability, recording every call. */
function mcpAdapter(name: string, options: RecordingMcpOptions = {}): TestAdapter {
  const io: string[] = []
  const baseDir = () => join(projectRoot, `.${name}`)
  const file = (type: string, assetName: string) => join(baseDir(), `${type}s`, `${assetName}.md`)
  const document = () => join(baseDir(), 'mcp.json')
  const mcp = recordingMcpCapability(document, options)
  return {
    io,
    mcpCalls: mcp.calls,
    get documentPath() {
      return document()
    },
    adapter: {
      name,
      apiVersion: ADAPTER_API_VERSION,
      supportsInstall: true,
      mcpServers: mcp.capability,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      // The SDK helpers verbatim, so the assemble → write → read → split
      // round trip matches every real adapter. A hand-rolled store that drops
      // metadata can never report an asset as unchanged, which would make the
      // equivalent-takeover case untestable.
      async installAsset(request) {
        io.push(`install:${request.assetType}:${request.name}`)
        const p = { file: file(request.assetType, request.name) }
        await installAssetFile(p, request.content, request.metadata as Record<string, unknown> | undefined)
        return { ok: true, primaryPath: p.file }
      },
      async readAsset(request) {
        io.push(`read:${request.assetType}:${request.name}`)
        try {
          const { content, metadata } = await readAssetFile({ file: file(request.assetType, request.name) })
          return request.assetType === 'skill'
            ? { ok: true, asset: { assetType: 'skill', content, metadata, companions: {} } }
            : { ok: true, asset: { assetType: request.assetType, content, metadata } }
        } catch {
          return { ok: false, failure: { code: 'not-found' } }
        }
      },
      async deleteAsset(request) {
        io.push(`delete:${request.assetType}:${request.name}`)
        const p = { file: file(request.assetType, request.name) }
        await deleteAssetFile(p)
        return { ok: true, existed: true, deletedPaths: [p.file] }
      },
    },
  }
}

/** An adapter that declares the current API but no MCP support. */
function decliningAdapter(name: string): Adapter {
  const built = mcpAdapter(name)
  return { ...built.adapter, apiVersion: ADAPTER_API_VERSION, mcpServers: false }
}

/** An adapter published against the superseded asset-only contract. */
function assetOnlyAdapter(name: string): Adapter {
  const built = mcpAdapter(name)
  const { mcpServers: _dropped, ...rest } = built.adapter as Adapter & { mcpServers?: unknown }
  return { ...rest, apiVersion: ADAPTER_API_VERSION_ASSETS_ONLY } as Adapter
}

function serverFixture(facet: string, server: string, declaration: unknown, version = '1.0.0'): string {
  const dir = join(projectRoot, 'vendor', facet)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'facet.json'), JSON.stringify({ name: facet, version, servers: { [server]: declaration } }))
  return `./vendor/${facet}`
}

function skillFixture(facet: string, skill: string, version = '1.0.0'): string {
  const dir = join(projectRoot, 'vendor', facet)
  mkdirSync(join(dir, `skills/${skill}`), { recursive: true })
  writeFileSync(
    join(dir, 'facet.json'),
    JSON.stringify({ name: facet, version, skills: { [skill]: { description: `${skill} skill` } } }),
  )
  writeFileSync(join(dir, `skills/${skill}/SKILL.md`), `# ${skill} from ${facet}\n`)
  return `./vendor/${facet}`
}

function writeManifest(value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`
  writeFileSync(join(projectRoot, 'facets.json'), text)
  return text
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-mcp-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-mcp-home-')))
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

describe('mcp — adapter support preflight', () => {
  test('an adapter declining MCP fails the run before anything is prepared or written', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const declining = decliningAdapter('declines')

    const result = await runInstall({ projectRoot, adapters: [declining], mcpConsent: ACCEPT })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MCP_ADAPTERS_UNSUPPORTED') expect.unreachable()
    expect(result.failure.adapters).toEqual([{ kind: 'capability-declined', adapter: 'declines' }])
    expect(result.failure.servers).toEqual(['filesystem'])
    // Before the journal: the operation never reached a mutation at all.
    expect(result.rollback.kind).toBe('not-needed')
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    expect(existsSync(receiptPath(projectRoot))).toBe(false)
  })

  test('every unsupported adapter is named, not just the first', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })

    const result = await runInstall({
      projectRoot,
      adapters: [assetOnlyAdapter('old'), decliningAdapter('declines'), mcpAdapter('good').adapter],
      mcpConsent: ACCEPT,
    })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MCP_ADAPTERS_UNSUPPORTED') expect.unreachable()
    expect(result.failure.adapters).toEqual([
      { kind: 'asset-only-api', adapter: 'old', apiVersion: ADAPTER_API_VERSION_ASSETS_ONLY },
      { kind: 'capability-declined', adapter: 'declines' },
    ])
  })

  test('a text-only project keeps an asset-only adapter usable', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })

    const result = await runInstall({ projectRoot, adapters: [assetOnlyAdapter('old')] })

    // No declarations means no MCP work, so support is never required and no
    // capability method is invoked. This is the whole point of the window.
    expect(result.ok).toBe(true)
  })

  test('an omitted declaration is not active, so it requires no MCP support', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { servers: { filesystem: { kind: 'omitted' } } } } },
    })

    expect((await runInstall({ projectRoot, adapters: [decliningAdapter('declines')] })).ok).toBe(true)
  })
})

describe('mcp — consent', () => {
  test('a non-interactive caller fails with the complete request and changes nothing', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    const result = await runInstall({ projectRoot, adapters: [rec.adapter] })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MCP_CONSENT_REQUIRED') expect.unreachable()
    const [declaration] = result.failure.request.declarations
    expect(declaration?.identity.effectiveName).toBe('filesystem')
    expect(declaration?.standing).toEqual({ kind: 'unknown-identity' })
    expect(declaration?.claimants.map((c) => c.facet)).toEqual(['alpha'])
    // The exact command is in the request: a user deciding whether to pass
    // --accept-mcp is deciding whether to let this run.
    expect(declaration?.declaration).toEqual(STDIO as never)

    // Prepared, never applied.
    expect(rec.mcpCalls).toEqual(['prepare:1'])
    expect(existsSync(rec.documentPath)).toBe(false)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('a declined request writes no configuration and records no approval', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      mcpConsent: { kind: 'interactive', resolve: async () => ({ kind: 'declined' }) },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MCP_CONSENT_DECLINED')
    expect(result.rollback.kind).toBe('not-needed')
    expect(existsSync(rec.documentPath)).toBe(false)
    expect(existsSync(receiptPath(projectRoot))).toBe(false)
  })

  test('approval applies the configuration and records the claim', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')

    let asked = 0
    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      mcpConsent: {
        kind: 'interactive',
        resolve: async () => {
          asked++
          return { kind: 'approved' }
        },
      },
    })

    if (!result.ok) expect.unreachable()
    expect(asked).toBe(1)
    expect(JSON.parse(readFileSync(rec.documentPath, 'utf8'))).toEqual({ filesystem: STDIO })

    // The receipt records the claim by fingerprint — never the command.
    const receipt = readFileSync(receiptPath(projectRoot), 'utf8')
    expect(JSON.parse(receipt).facets.alpha.configurations).toEqual([
      {
        kind: 'mcp-server',
        name: 'filesystem',
        materialization: { kind: 'authored' },
        fingerprint: expect.any(String),
      },
    ])
    for (const secret of ['npx', 'server-filesystem']) {
      expect(receipt).not.toContain(secret)
    }
  })

  test('an approved declaration is not asked about again', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)

    let asked = 0
    const again = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      mcpConsent: {
        kind: 'interactive',
        resolve: async () => {
          asked++
          return { kind: 'approved' }
        },
      },
    })

    expect(again.ok).toBe(true)
    expect(asked).toBe(0)
  })

  test('a changed declaration is asked about again, and says so', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: a } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)

    // Same facet, same name, different command: a name the user already
    // trusted now runs something else.
    serverFixture('alpha', 'filesystem', { type: 'stdio', command: 'other-mcp' }, '1.0.1')

    let seen: McpConsentRequest | undefined
    const again = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      mcpConsent: {
        kind: 'interactive',
        resolve: async (request) => {
          seen = request
          return { kind: 'approved' }
        },
      },
    })

    expect(again.ok).toBe(true)
    expect(seen?.declarations[0]?.standing).toEqual({ kind: 'declaration-changed' })
  })

  test('approval is machine-local: a teammate with the same files is asked', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)

    // The receipt is machine-local and never committed, so a teammate's clone
    // has the same manifest, lockfile, and configuration document — and no
    // approval evidence at all.
    rmSync(receiptPath(projectRoot), { force: true })

    const teammate = await runInstall({ projectRoot, adapters: [rec.adapter] })
    if (teammate.ok) expect.unreachable()
    expect(teammate.failure.code).toBe('MCP_CONSENT_REQUIRED')
  })

  test('an untracked native entry is disclosed as a takeover', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    // Someone configured this server by hand, differently.
    mkdirSync(join(projectRoot, '.rec'), { recursive: true })
    writeFileSync(rec.documentPath, `${JSON.stringify({ filesystem: HTTP }, null, 2)}\n`)

    let seen: McpConsentRequest | undefined
    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      mcpConsent: {
        kind: 'interactive',
        resolve: async (request) => {
          seen = request
          return { kind: 'approved' }
        },
      },
    })

    expect(result.ok).toBe(true)
    expect(seen?.takeovers).toEqual([
      {
        adapter: 'rec',
        identity: { kind: 'mcp-server', effectiveName: 'filesystem' },
        existing: 'divergent',
        declaration: STDIO as never,
      },
    ])
  })
})

describe('mcp — application and rollback', () => {
  test('a later adapter failure restores the earlier document byte-for-byte', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const first = mcpAdapter('first')
    const second = mcpAdapter('second', {
      failApply: { code: 'io-failed', operation: 'write', path: '/nope', message: 'disk on fire' },
    })

    // A pre-existing document with formatting the engine has no way to
    // reproduce semantically — which is exactly why rollback restores bytes.
    mkdirSync(join(projectRoot, '.first'), { recursive: true })
    const before = '{\n\t"legacy": {"type":"stdio","command":"keep-me"}\n}\n'
    writeFileSync(first.documentPath, before)

    const result = await runInstall({
      projectRoot,
      adapters: [first.adapter, second.adapter],
      mcpConsent: ACCEPT,
    })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MCP_APPLY_FAILED') expect.unreachable()
    expect(result.failure.adapter).toBe('second')
    expect(result.rollback.kind).toBe('succeeded')
    expect(readFileSync(first.documentPath, 'utf8')).toBe(before)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('a document created by the run is deleted again on rollback', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const first = mcpAdapter('first')
    const second = mcpAdapter('second', {
      failApply: { code: 'conflict', path: '/nope', message: 'cannot represent' },
    })

    const result = await runInstall({
      projectRoot,
      adapters: [first.adapter, second.adapter],
      mcpConsent: ACCEPT,
    })

    if (result.ok) expect.unreachable()
    // "Absent" is a preimage too: restoring it removes the file this run made.
    expect(existsSync(first.documentPath)).toBe(false)
  })

  test('a preparation failure stops the run before any asset is written', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: skillFixture('beta', 'review'),
      },
    })
    const rec = mcpAdapter('rec', {
      failPrepare: { code: 'parse-failed', path: '/project/.rec/mcp.json', message: 'unexpected token' },
    })

    const result = await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MCP_PREPARE_FAILED')
    // No asset write, no asset read: preparation precedes the journal.
    expect(rec.io).toEqual([])
  })

  test('a write to an undisclosed path is refused as a contract breach', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec', { applyUndisclosedPath: () => join(projectRoot, 'elsewhere.json') })

    const result = await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MCP_CONTRACT_VIOLATION') expect.unreachable()
    expect(result.failure.violation.kind).toBe('undisclosed-changed-path')
  })
})

describe('mcp — frozen reproduction', () => {
  test('frozen never opens a prompt, even with a resolver in hand', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)
    rmSync(receiptPath(projectRoot), { force: true })

    let asked = 0
    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      frozenLockfile: true,
      mcpConsent: {
        kind: 'interactive',
        resolve: async () => {
          asked++
          return { kind: 'approved' }
        },
      },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MCP_CONSENT_REQUIRED')
    expect(asked).toBe(0)
  })

  test('frozen honors a pre-supplied approval and still writes only the receipt', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: a } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)

    const manifestBefore = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    rmSync(rec.documentPath, { force: true })

    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      frozenLockfile: true,
      mcpConsent: ACCEPT,
    })

    expect(result.ok).toBe(true)
    expect(JSON.parse(readFileSync(rec.documentPath, 'utf8'))).toEqual({ filesystem: STDIO })
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(manifestBefore)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })

  test('frozen reports a stale server override instead of pruning it', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: a } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)

    const manifestBefore = writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { servers: { gone: { kind: 'omitted' } } } } },
    })
    const documentBefore = readFileSync(rec.documentPath, 'utf8')

    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      frozenLockfile: true,
      mcpConsent: ACCEPT,
    })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    const entry = result.failure.facets[0]
    if (entry?.reason !== 'stale-override') expect.unreachable()
    expect(entry.contribution).toEqual({ kind: 'mcp-server' })
    expect(entry.authoredName).toBe('gone')
    // A normal install prunes this inside its transaction; frozen has no
    // transaction, so it must leave the intent exactly where it found it.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(manifestBefore)
    expect(readFileSync(rec.documentPath, 'utf8')).toBe(documentBefore)
  })

  test('a server-only override does not make an older lockfile unrepresentable', async () => {
    // Servers have no lockfile representation at any version, so an entry
    // whose only override is a server alias asks nothing of the lockfile
    // format. Reporting a migration here would name a fix that changes
    // nothing.
    const a = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: a } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)

    const lockfile = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    lockfile.lockfileVersion = 0.2
    for (const facet of Object.values(lockfile.facets) as Array<Record<string, unknown>>) {
      facet.assets = []
    }
    writeFileSync(join(projectRoot, 'facets.lock'), `${JSON.stringify(lockfile, null, 2)}\n`)
    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { servers: { filesystem: { kind: 'aliased', as: 'fs' } } } } },
    })

    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      frozenLockfile: true,
      mcpConsent: ACCEPT,
    })

    // It may still fail for a reason of its own, but never for this one.
    if (!result.ok && result.failure.code === 'LOCKFILE_DRIFT') {
      expect(result.failure.facets.map((f) => f.reason)).not.toContain('materialization-unrepresentable')
    }
  })
})

describe('mcp — offline removal', () => {
  test('removing the last claimant deletes the owned server entry offline', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: skillFixture('beta', 'review'),
      },
    })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)
    expect(JSON.parse(readFileSync(rec.documentPath, 'utf8'))).toEqual({ filesystem: STDIO })

    // The facet's source is gone: nothing may be fetched or rebuilt.
    rmSync(join(projectRoot, 'vendor/alpha'), { recursive: true, force: true })

    const removed = await runRemove({ projectRoot, names: ['alpha'], adapters: [rec.adapter] })

    expect(removed.ok).toBe(true)
    expect(JSON.parse(readFileSync(rec.documentPath, 'utf8'))).toEqual({})
    expect(JSON.parse(readFileSync(receiptPath(projectRoot), 'utf8')).facets.alpha).toBeUndefined()
  })

  test('a remaining claimant preserves the server', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: serverFixture('beta', 'filesystem', STDIO),
      },
    })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter], mcpConsent: ACCEPT })).ok).toBe(true)

    rmSync(join(projectRoot, 'vendor/alpha'), { recursive: true, force: true })
    const removed = await runRemove({ projectRoot, names: ['alpha'], adapters: [rec.adapter] })

    expect(removed.ok).toBe(true)
    // beta still claims it, so the entry stays exactly as it is.
    expect(JSON.parse(readFileSync(rec.documentPath, 'utf8'))).toEqual({ filesystem: STDIO })
  })

  test('a pre-configuration receipt falls back to ordinary resolution', async () => {
    writeManifest({
      facets: {
        alpha: skillFixture('alpha', 'review'),
        beta: skillFixture('beta', 'other'),
      },
    })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter] })).ok).toBe(true)

    // Rewrite the receipt at the version that predates configuration claims.
    const receipt = JSON.parse(readFileSync(receiptPath(projectRoot), 'utf8'))
    receipt.version = 0.3
    for (const facet of Object.values(receipt.facets) as Array<Record<string, unknown>>) {
      delete facet.configurations
      delete facet.integrity
    }
    writeFileSync(receiptPath(projectRoot), `${JSON.stringify(receipt, null, 2)}\n`)

    const reasons: string[] = []
    const removed = await runRemove({
      projectRoot,
      names: ['alpha'],
      adapters: [rec.adapter],
      onStage: (event) => {
        if (event.kind === 'removal-resolution-required') reasons.push(event.reason)
      },
    })

    // It falls back rather than guessing; the sources are still present, so
    // the ordinary pipeline then succeeds.
    expect(reasons).toEqual(['configuration-unwitnessed'])
    expect(removed.ok).toBe(true)
  })
})

describe('asset takeover', () => {
  /** Put an untracked file exactly where the desired skill will land. */
  function occupy(adapterName: string, skill: string, body: string): string {
    const path = join(projectRoot, `.${adapterName}`, 'skills', `${skill}.md`)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body)
    return path
  }

  test('an occupied untracked destination is disclosed before it is replaced', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    const path = occupy('rec', 'review', '# hand written\n')

    const seen: AssetTakeoverRequest[] = []
    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      resolveAssetTakeover: async (request) => {
        seen.push(request)
        return { kind: 'continue' }
      },
    })

    expect(result.ok).toBe(true)
    expect(seen).toEqual([
      {
        facet: 'alpha',
        adapter: 'rec',
        asset: assetIdentity('project', 'skill', 'review'),
        authoredName: 'review',
        occupancy: 'divergent',
      },
    ])
    expect(readFileSync(path, 'utf8')).toContain('review from alpha')
  })

  test('cancelling restores every prior mutation and commits nothing', async () => {
    writeManifest({
      facets: {
        alpha: skillFixture('alpha', 'a-review'),
        beta: skillFixture('beta', 'b-review'),
      },
    })
    const rec = mcpAdapter('rec')
    occupy('rec', 'b-review', '# hand written\n')

    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      resolveAssetTakeover: async () => ({ kind: 'cancelled' }),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'ASSET_TAKEOVER_CANCELLED') expect.unreachable()
    expect(String(result.failure.asset.name)).toBe('b-review')
    expect(result.rollback.kind).toBe('succeeded')
    // The facet written before the gate was reached is gone again, and the
    // project files were never committed.
    expect(existsSync(join(projectRoot, '.rec', 'skills', 'a-review.md'))).toBe(false)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('an owned destination reconciles without asking', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter] })).ok).toBe(true)

    // Drift it, so the second run has real work to do at an owned identity.
    writeFileSync(join(projectRoot, '.rec', 'skills', 'review.md'), '# drifted\n')

    let asked = 0
    const again = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      resolveAssetTakeover: async () => {
        asked++
        return { kind: 'continue' }
      },
    })

    expect(again.ok).toBe(true)
    expect(asked).toBe(0)
  })

  test('an equivalent untracked destination is adopted without rewriting it', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter] })).ok).toBe(true)

    // Forget the identity while leaving the bytes: a clone whose receipt is
    // machine-local, or a project whose receipt was lost. The destination is
    // now untracked AND already exactly right.
    rmSync(receiptPath(projectRoot), { force: true })
    const before = rec.io.length

    const seen: AssetTakeoverRequest[] = []
    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      resolveAssetTakeover: async (request) => {
        seen.push(request)
        return { kind: 'continue' }
      },
    })

    if (!result.ok) expect.unreachable()
    expect(seen[0]?.occupancy).toBe('equivalent')
    // Adopted: nothing was written, and the identity is tracked again.
    expect(rec.io.slice(before).filter((call) => call.startsWith('install:'))).toEqual([])
    expect(JSON.parse(readFileSync(receiptPath(projectRoot), 'utf8')).facets.alpha.assets).toHaveLength(1)
  })

  test('a non-interactive run continues automatically', async () => {
    writeManifest({ facets: { alpha: skillFixture('alpha', 'review') } })
    const rec = mcpAdapter('rec')
    const path = occupy('rec', 'review', '# hand written\n')

    expect((await runInstall({ projectRoot, adapters: [rec.adapter] })).ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('review from alpha')
  })

  test('frozen mode never opens the gate', async () => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const rec = mcpAdapter('rec')
    expect((await runInstall({ projectRoot, adapters: [rec.adapter] })).ok).toBe(true)

    // Forget the identity, so the destination reads as untracked again.
    rmSync(receiptPath(projectRoot), { force: true })

    let asked = 0
    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      frozenLockfile: true,
      resolveAssetTakeover: async () => {
        asked++
        return { kind: 'continue' }
      },
    })

    expect(result.ok).toBe(true)
    expect(asked).toBe(0)
  })

  test('MCP approval does not accept an asset takeover', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: skillFixture('beta', 'review'),
      },
    })
    const rec = mcpAdapter('rec')
    occupy('rec', 'review', '# hand written\n')

    let asked = 0
    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      // Pre-supplied MCP approval, which must say nothing about assets.
      mcpConsent: ACCEPT,
      resolveAssetTakeover: async () => {
        asked++
        return { kind: 'cancelled' }
      },
    })

    if (result.ok) expect.unreachable()
    expect(asked).toBe(1)
    expect(result.failure.code).toBe('ASSET_TAKEOVER_CANCELLED')
  })
})

describe('mcp — interruption', () => {
  test('an abort after approval rolls the operation back', async () => {
    writeManifest({ facets: { alpha: serverFixture('alpha', 'filesystem', STDIO) } })
    const rec = mcpAdapter('rec')
    const controller = new AbortController()

    const result = await runInstall({
      projectRoot,
      adapters: [rec.adapter],
      signal: controller.signal,
      mcpConsent: {
        kind: 'interactive',
        resolve: async () => {
          controller.abort()
          return { kind: 'approved' }
        },
      },
    })

    if (result.ok) expect.unreachable()
    // The signal is the honest account of what happened, even though the
    // screen settled as approved.
    expect(result.failure.code).toBe('ABORTED')
    expect(readIfPresent(rec.documentPath)).toBeNull()
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })
})
