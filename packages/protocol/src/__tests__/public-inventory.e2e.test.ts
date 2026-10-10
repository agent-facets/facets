/**
 * The published package, consumed the way a third party consumes it.
 *
 * `public-inventory.test.ts` proves the verification workflow against source.
 * This proves it against what npm would actually serve: a tarball packed from
 * the published manifest, extracted into a fresh project outside the
 * workspace, with only the package's installed dependency closure beside it.
 * Node runs it with Bun unreachable — not filtered from `$PATH` but absent,
 * shims included — and with network entry points guarded. `tsgo` then checks
 * a consumer against the emitted declarations, resolving nothing from the
 * workspace.
 *
 * Requires `bun run build` first — wired via the `test:e2e` script.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeMcpServerFingerprint, type McpServerDeclaration } from '@agent-facets/protocol'
import {
  installClosure,
  installedPackageDir,
  installPackedProtocol,
  PACKAGE_ROOT,
  type PackedPackage,
  REPO_ROOT,
} from './helpers/packed-package.ts'

const LAUNCHER = join(REPO_ROOT, 'scripts', 'smoke', 'node-only.mjs')
const WORKSPACE_MANIFEST = join(PACKAGE_ROOT, 'package.json')
const PACK_BACKUP = join(PACKAGE_ROOT, '.package.json.bak')

const FILESYSTEM: McpServerDeclaration = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@example/server-filesystem', '/workspace'],
  env: { ROOT: '/workspace' },
}
const DOCS: McpServerDeclaration = { type: 'http', url: 'https://docs.example/mcp' }

/** The committed lockfile the consumer verifies its exports against. */
const LOCKFILE = {
  lockfileVersion: 0.4,
  facets: {
    alpha: {
      source: { kind: 'registry', registry: 'https://cafe.example' },
      version: '1.2.0',
      integrity: `sha256:${'a'.repeat(64)}`,
      assets: [],
      servers: [
        {
          name: 'filesystem',
          fingerprint: computeMcpServerFingerprint(FILESYSTEM),
          materialization: { kind: 'aliased', as: 'workspace-files' },
        },
      ],
    },
    beta: {
      source: { kind: 'local', path: '../beta' },
      version: '0.3.1',
      integrity: `sha256:${'b'.repeat(64)}`,
      assets: [],
      servers: [
        { name: 'docs', fingerprint: computeMcpServerFingerprint(DOCS), materialization: { kind: 'authored' } },
        {
          name: 'files',
          fingerprint: computeMcpServerFingerprint(FILESYSTEM),
          materialization: { kind: 'aliased', as: 'workspace-files' },
        },
      ],
    },
  },
}

/** Export variants: what an exporter wrote, keyed by the case under test. */
const VARIANTS: Record<string, Record<string, McpServerDeclaration>> = {
  matching: { 'workspace-files': FILESYSTEM, docs: DOCS },
  reordered: {
    'workspace-files': { ...FILESYSTEM, args: ['/workspace', '@example/server-filesystem', '-y'] },
    docs: DOCS,
  },
  missing: { 'workspace-files': FILESYSTEM },
  unexpected: { 'workspace-files': FILESYSTEM, docs: DOCS, extra: { type: 'http', url: 'https://extra.example' } },
}

/**
 * The consumer: plain JavaScript importing the package by name, exactly as a
 * downstream exporter would. It reports facts rather than asserting them, so
 * the assertions live in this file where a failure is readable.
 */
const CONSUMER = `
import dns from 'node:dns'
import http from 'node:http'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  computeMcpServerFingerprint,
  deriveLockedMcpInventory,
  LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING,
  MCP_SERVER_FINGERPRINT_ENCODING,
  parseLockfileDocument,
} from '@agent-facets/protocol'
import { MCP_SERVER_TRANSPORTS } from '@agent-facets/protocol/mcp-declaration'

async function canary(attempt) {
  try {
    await attempt()
    return 'reachable'
  } catch (error) {
    return String(error?.message).startsWith('network access denied') ? 'denied' : 'other: ' + error?.message
  }
}

function compare(text, exported) {
  const parsed = parseLockfileDocument(text)
  if (!parsed.ok) return { ok: false, reason: 'unreadable' }
  const inventory = deriveLockedMcpInventory(parsed.data.lockfile)
  if (!inventory.ok) return { ok: false, reason: inventory.reason }
  const expected = new Map(inventory.servers.map((server) => [server.effectiveName, server.fingerprint]))
  const observed = new Map(Object.entries(exported).map(([name, d]) => [name, computeMcpServerFingerprint(d)]))
  const missing = [...expected.keys()].filter((name) => !observed.has(name)).sort()
  const unexpected = [...observed.keys()].filter((name) => !expected.has(name)).sort()
  const changed = [...expected].filter(([n, f]) => observed.has(n) && observed.get(n) !== f).map(([n]) => n).sort()
  return missing.length + unexpected.length + changed.length === 0
    ? { ok: true }
    : { ok: false, reason: 'mismatch', missing, unexpected, changed }
}

const lockfile = readFileSync(new URL('./lockfile.json', import.meta.url), 'utf8')
const variants = JSON.parse(readFileSync(new URL('./exports.json', import.meta.url), 'utf8'))
const parsed = parseLockfileDocument(lockfile)

console.log(JSON.stringify({
  node: process.versions.node,
  bunGlobal: typeof globalThis.Bun,
  bunOnPath: spawnSync('bun', ['--version']).error?.code ?? 'resolved',
  resolved: {
    main: import.meta.resolve('@agent-facets/protocol'),
    declaration: import.meta.resolve('@agent-facets/protocol/mcp-declaration'),
  },
  canaries: {
    fetch: await canary(() => fetch('http://127.0.0.1:9/')),
    http: await canary(() => http.get('http://127.0.0.1:9/')),
    net: await canary(() => net.connect(9, '127.0.0.1')),
    dns: await canary(() => dns.lookup('example.com', () => {})),
  },
  transports: MCP_SERVER_TRANSPORTS,
  encodings: [MCP_SERVER_FINGERPRINT_ENCODING, LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING],
  inventory: parsed.ok ? deriveLockedMcpInventory(parsed.data.lockfile) : null,
  comparisons: Object.fromEntries(Object.entries(variants).map(([name, exported]) => [name, compare(lockfile, exported)])),
  legacy: compare(JSON.stringify({ lockfileVersion: 0.3, facets: {} }), {}),
}))
`

/**
 * A typed consumer of the emitted declarations. Every `@ts-expect-error` is a
 * check in its own right: if a declaration degraded to `any` the directive
 * would be unused, and that is itself a compile error.
 */
const TYPED_CONSUMER = `
import {
  computeMcpServerFingerprint,
  type CurrentLockfileFacet,
  type DeriveLockedMcpInventoryResult,
  deriveLockedMcpInventory,
  type McpServerFingerprint,
  parseLockfileDocument,
} from '@agent-facets/protocol'
import type { McpServerDeclaration } from '@agent-facets/protocol/mcp-declaration'

const declaration: McpServerDeclaration = { type: 'http', url: 'https://docs.example/mcp' }
const fingerprint: McpServerFingerprint = computeMcpServerFingerprint(declaration)

// @ts-expect-error a declaration is a closed union; an unknown transport is not one
const sse: McpServerDeclaration = { type: 'sse', url: 'https://docs.example/mcp' }

// @ts-expect-error a current facet entry requires its server inventory
const incomplete: CurrentLockfileFacet = { source: { kind: 'local', path: '../x' }, version: '1.0.0', integrity: 'x', assets: [] }

export function inspect(text: string): string {
  const parsed = parseLockfileDocument(text)
  if (!parsed.ok) return parsed.failure.code
  const result: DeriveLockedMcpInventoryResult = deriveLockedMcpInventory(parsed.data.lockfile)
  if (result.ok) {
    const first = result.servers[0]
    if (first === undefined) return 'empty'
    // A selected server always has at least one origin, statically.
    const origin = first.origins[0]
    // @ts-expect-error public output is readonly
    first.origins = [origin]
    return origin.authoredName + fingerprint
  }
  if (result.reason === 'inventory-unavailable') {
    const observed: 0.2 | 0.3 = result.lockfileVersion
    const required: 0.4 = result.requiredVersion
    return String(observed + required)
  }
  return result.groups.map((group) => group.effectiveName).join(',') + sse + incomplete
}
`

/** The same consumer with one honest type error, proving the check is live. */
const BROKEN_CONSUMER = `
import { computeMcpServerFingerprint } from '@agent-facets/protocol'
export const wrong: number = computeMcpServerFingerprint({ type: 'http', url: 'https://docs.example/mcp' })
`

let workdir: string
let consumerRoot: string
let packed: PackedPackage
let manifestBefore: string

const NODE = Bun.which('node')

/** Run a script through the shared Node-only launcher. */
function nodeOnly(args: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  if (NODE === null) throw new Error('[e2e] node is not on PATH; Node 22+ is required for this test')
  const result = Bun.spawnSync([NODE, LAUNCHER, ...args], { cwd: consumerRoot, stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

beforeAll(() => {
  manifestBefore = readFileSync(WORKSPACE_MANIFEST, 'utf8')
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'facet-protocol-e2e-')))
  consumerRoot = join(workdir, 'consumer')

  packed = installPackedProtocol(workdir, consumerRoot)
  const runtime = Object.keys((packed.manifest.dependencies ?? {}) as Record<string, string>)
  installClosure(consumerRoot, runtime, PACKAGE_ROOT)
  // Node's own types, for the declaration check only.
  installClosure(consumerRoot, ['@types/node'], REPO_ROOT)

  writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({ name: 'consumer', type: 'module' })}\n`)
  writeFileSync(join(consumerRoot, 'lockfile.json'), JSON.stringify(LOCKFILE))
  writeFileSync(join(consumerRoot, 'exports.json'), JSON.stringify(VARIANTS))
  writeFileSync(join(consumerRoot, 'consumer.mjs'), CONSUMER)
  writeFileSync(join(consumerRoot, 'typed.mts'), TYPED_CONSUMER)
  writeFileSync(join(consumerRoot, 'broken.mts'), BROKEN_CONSUMER)
})

afterAll(() => {
  if (workdir !== undefined) rmSync(workdir, { recursive: true, force: true })
  // Packing never touched the workspace package: the manifest is byte-for-byte
  // what it was, and no lifecycle backup was left beside it.
  expect(readFileSync(WORKSPACE_MANIFEST, 'utf8')).toBe(manifestBefore)
  expect(existsSync(PACK_BACKUP)).toBe(false)
})

describe('the packed artifact', () => {
  test('publishes built output under the published export map', () => {
    expect(packed.manifest.exports).toEqual({
      '.': { import: './dist/index.mjs', types: './dist/index.d.mts' },
      './mcp-declaration': { import: './dist/mcp-declaration.mjs', types: './dist/mcp-declaration.d.mts' },
    })
    expect(packed.manifest.devDependencies).toBeUndefined()
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const specifiers = Object.values((packed.manifest[field] ?? {}) as Record<string, string>)
      expect(specifiers.filter((specifier) => specifier.startsWith('workspace:'))).toEqual([])
    }
  })

  test('contains the manifest and built output, and no source', () => {
    for (const file of packed.files) expect(file === 'package.json' || file.startsWith('dist/')).toBe(true)
    expect(packed.files).toContain('dist/index.mjs')
    expect(packed.files).toContain('dist/index.d.mts')
    expect(packed.files).toContain('dist/mcp-declaration.mjs')
    expect(packed.files).toContain('dist/mcp-declaration.d.mts')
  })
})

describe('a Node-only consumer of the packed package', () => {
  // One run, many facts: spawning is the expensive part, and every assertion
  // below is about this same isolated process.
  let report: {
    node: string
    bunGlobal: string
    bunOnPath: string
    resolved: { main: string; declaration: string }
    canaries: Record<string, string>
    transports: string[]
    encodings: string[]
    inventory: unknown
    comparisons: Record<string, unknown>
    legacy: unknown
  }

  beforeAll(() => {
    const run = nodeOnly(['--deny-network', join(consumerRoot, 'consumer.mjs')])
    if (run.exitCode !== 0) throw new Error(`[e2e] consumer failed (${run.exitCode}):\n${run.stderr}`)
    report = JSON.parse(run.stdout)
  })

  test('runs on Node 22+ with Bun neither loaded nor reachable', () => {
    expect(Number(report.node.split('.')[0])).toBeGreaterThanOrEqual(22)
    expect(report.bunGlobal).toBe('undefined')
    expect(report.bunOnPath).toBe('ENOENT')
  })

  test('resolves both entrypoints to the extracted build, not the workspace', () => {
    const packageUrl = pathToFileURL(join(consumerRoot, 'node_modules', '@agent-facets', 'protocol')).href
    expect(report.resolved.main).toBe(`${packageUrl}/dist/index.mjs`)
    expect(report.resolved.declaration).toBe(`${packageUrl}/dist/mcp-declaration.mjs`)
    expect(report.transports).toEqual(['stdio', 'http'])
  })

  test('ran with every guarded network entry point refusing', () => {
    expect(report.canaries).toEqual({ fetch: 'denied', http: 'denied', net: 'denied', dns: 'denied' })
  })

  test('publishes the fixed 0.4 fingerprint encoding', () => {
    expect(report.encodings).toEqual(['facets:mcp-server:v1', 'facets:mcp-server:v1'])
  })

  test('verifies exports offline, and every kind of disagreement is caught', () => {
    expect(report.comparisons).toEqual({
      matching: { ok: true },
      reordered: { ok: false, reason: 'mismatch', missing: [], unexpected: [], changed: ['workspace-files'] },
      missing: { ok: false, reason: 'mismatch', missing: ['docs'], unexpected: [], changed: [] },
      unexpected: { ok: false, reason: 'mismatch', missing: [], unexpected: ['extra'], changed: [] },
    })
    expect(report.legacy).toEqual({ ok: false, reason: 'inventory-unavailable' })
  })

  test('derives every origin and discloses no declaration value', () => {
    const inventory = report.inventory as {
      ok: true
      servers: { effectiveName: string; origins: { facet: string; authoredName: string }[] }[]
    }
    expect(inventory.ok).toBe(true)
    expect(
      inventory.servers.map((server) => [
        server.effectiveName,
        server.origins.map((o) => `${o.facet}/${o.authoredName}`),
      ]),
    ).toEqual([
      ['docs', ['beta/docs']],
      ['workspace-files', ['alpha/filesystem', 'beta/files']],
    ])
    const serialized = JSON.stringify(inventory)
    for (const value of ['npx', 'server-filesystem', '/workspace', 'docs.example']) {
      expect(serialized).not.toContain(value)
    }
  })
})

describe('the packed declarations', () => {
  const tsgo = join(installedPackageDir('@typescript/native-preview', REPO_ROOT), 'bin', 'tsgo')
  // Explicit options and an explicit file, and no project: nothing here may
  // pick up a workspace tsconfig, path alias, or Bun's types.
  const flags = [
    '--noEmit',
    '--strict',
    '--target',
    'es2022',
    '--module',
    'nodenext',
    '--moduleResolution',
    'nodenext',
    '--types',
    'node',
  ]

  test('type-check a strict consumer of both entrypoints', () => {
    const run = nodeOnly([tsgo, ...flags, join(consumerRoot, 'typed.mts')])
    expect(`${run.stdout}${run.stderr}`).toBe('')
    expect(run.exitCode).toBe(0)
  })

  test('reject a consumer that misuses them', () => {
    const run = nodeOnly([tsgo, ...flags, join(consumerRoot, 'broken.mts')])
    expect(run.exitCode).not.toBe(0)
    expect(run.stdout).toContain('broken.mts')
    expect(run.stdout).toContain("not assignable to type 'number'")
  })
})
