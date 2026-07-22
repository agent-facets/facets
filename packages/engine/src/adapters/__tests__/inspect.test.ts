import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import { inspectInstalledAdapter, inspectInstalledAdapters } from '../inspect.ts'
import { GENERATIONS_DIR_NAME, INSTALLATION_RECEIPT_NAME, type InstallationSource } from '../installation.ts'
import { loadInstalledAdapters } from '../loader.ts'
import { placeAdapter, placeAdapterManaged } from '../placement.ts'

let facetDir: string
let baseDir: string
let workDir: string
let originalFacetDir: string | undefined

beforeEach(async () => {
  facetDir = await mkdtemp(join(tmpdir(), 'facet-inspect-'))
  baseDir = join(facetDir, 'adapters')
  workDir = await mkdtemp(join(tmpdir(), 'facet-inspect-work-'))
  originalFacetDir = process.env.FACET_DIR
  process.env.FACET_DIR = facetDir
})

afterEach(async () => {
  if (originalFacetDir === undefined) {
    delete process.env.FACET_DIR
  } else {
    process.env.FACET_DIR = originalFacetDir
  }
  await rm(facetDir, { recursive: true, force: true }).catch(() => {})
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
})

let bundleCounter = 0
async function makeBundle(
  name: string,
  opts: { apiVersion?: string | null; marker?: string; sideEffectFile?: string } = {},
): Promise<string> {
  const api = opts.apiVersion === null ? '' : `apiVersion: '${opts.apiVersion ?? ADAPTER_API_VERSION}',`
  const sideEffect = opts.sideEffectFile ? `await Bun.write('${opts.sideEffectFile}', 'imported')\n` : ''
  const path = join(workDir, `bundle-${++bundleCounter}.mjs`)
  await Bun.write(
    path,
    `${sideEffect}export const marker = '${opts.marker ?? 'default'}'
export default {
  name: '${name}',
  ${api}
  buildAssetMetadata: () => ({ ok: true, data: { marker: '${opts.marker ?? 'default'}' } }),
  installAsset: async () => undefined,
  readAsset: async () => ({ content: '' }),
  deleteAsset: async () => undefined,
}
`,
  )
  return path
}

const source: InstallationSource = {
  kind: 'npm',
  specifier: 'my-adapter@1.0.0',
  packageName: 'my-adapter',
  version: '1.0.0',
  integrity: { kind: 'sri', value: 'sha512-test' },
}

async function installManaged(name: string, bundle: string, apiVersion = ADAPTER_API_VERSION): Promise<string> {
  const result = await placeAdapterManaged(name, bundle, { apiVersion, source }, baseDir)
  if (!result.ok) throw new Error(`test bug: managed install failed (${result.failure.kind})`)
  return result.receipt.activeGeneration
}

describe('inspectInstalledAdapter — managed', () => {
  test('valid managed installation is compatible with managed repair', async () => {
    await installManaged('my-adapter', await makeBundle('my-adapter'))
    const inspection = await inspectInstalledAdapter('my-adapter', baseDir)
    if (inspection.kind !== 'compatible') expect.unreachable()
    expect(inspection.managed).toBe(true)
    expect(inspection.verified.apiVersion).toBe(ADAPTER_API_VERSION)
    expect(inspection.repair).toEqual({ kind: 'managed', specifier: 'my-adapter@1.0.0' })
  })

  test('recorded unsupported API is incompatible without importing the bundle', async () => {
    await installManaged('my-adapter', await makeBundle('my-adapter'))
    // Rewrite the receipt to claim an unsupported API, and give the
    // active generation a bundle that records a side effect on import.
    const sideEffectFile = join(workDir, 'was-imported.txt')
    const receiptPath = join(baseDir, 'my-adapter', INSTALLATION_RECEIPT_NAME)
    const receipt = await Bun.file(receiptPath).json()
    const genBundle = join(baseDir, 'my-adapter', GENERATIONS_DIR_NAME, receipt.activeGeneration, 'adapter.js')
    await Bun.write(genBundle, await Bun.file(await makeBundle('my-adapter', { sideEffectFile })).text())
    receipt.apiVersion = '9.9'
    await Bun.write(receiptPath, JSON.stringify(receipt))

    const inspection = await inspectInstalledAdapter('my-adapter', baseDir)
    if (inspection.kind !== 'incompatible') expect.unreachable()
    expect(inspection.failure).toEqual({
      kind: 'api-unsupported',
      adapter: 'my-adapter',
      found: '9.9',
      supported: [ADAPTER_API_VERSION],
    })
    // The bundle was never imported.
    expect(await Bun.file(sideEffectFile).exists()).toBe(false)
  })

  test('receipt/runtime disagreement is incompatible', async () => {
    // Fabricate the managed layout directly (never imported before) so
    // the runtime declaration genuinely differs from the receipt's.
    // With a single supported API the disagreement classifies as
    // api-unsupported (support check precedes metadata equality).
    const genDir = join(baseDir, 'my-adapter', GENERATIONS_DIR_NAME, 'gen-fixture-drift')
    await mkdir(genDir, { recursive: true })
    await Bun.write(
      join(genDir, 'adapter.js'),
      await Bun.file(await makeBundle('my-adapter', { apiVersion: '0.1' })).text(),
    )
    await Bun.write(
      join(baseDir, 'my-adapter', INSTALLATION_RECEIPT_NAME),
      JSON.stringify({
        schemaVersion: 1,
        activeGeneration: 'gen-fixture-drift',
        apiVersion: ADAPTER_API_VERSION,
        source,
      }),
    )

    const inspection = await inspectInstalledAdapter('my-adapter', baseDir)
    if (inspection.kind !== 'incompatible') expect.unreachable()
    expect(inspection.failure.kind).toBe('api-unsupported')
  })

  test('invalid receipt classifies as broken and keeps a repair source', async () => {
    await installManaged('my-adapter', await makeBundle('my-adapter'))
    await Bun.write(join(baseDir, 'my-adapter', INSTALLATION_RECEIPT_NAME), '{not json')

    const inspection = await inspectInstalledAdapter('my-adapter', baseDir)
    if (inspection.kind !== 'broken') expect.unreachable()
    if (inspection.reason.kind !== 'invalid-receipt') expect.unreachable()
    expect(inspection.repair).toEqual({ kind: 'unmanaged-name', name: 'my-adapter' })
  })

  test('missing active generation classifies as broken with the declared API', async () => {
    const generation = await installManaged('my-adapter', await makeBundle('my-adapter'))
    await rm(join(baseDir, 'my-adapter', GENERATIONS_DIR_NAME, generation), { recursive: true, force: true })

    const inspection = await inspectInstalledAdapter('my-adapter', baseDir)
    if (inspection.kind !== 'broken') expect.unreachable()
    expect(inspection.reason).toEqual({ kind: 'missing-active-generation', generation })
    expect(inspection.declaredApi).toBe(ADAPTER_API_VERSION)
  })

  test('unloadable active bundle classifies as broken (load-failed)', async () => {
    // Fabricated directly at a never-imported path so the dynamic-import
    // cache can't mask the unloadable bytes.
    const genDir = join(baseDir, 'my-adapter', GENERATIONS_DIR_NAME, 'gen-fixture-unloadable')
    await mkdir(genDir, { recursive: true })
    await Bun.write(join(genDir, 'adapter.js'), `import missing from 'no-such-package-xyz'\nexport default missing`)
    await Bun.write(
      join(baseDir, 'my-adapter', INSTALLATION_RECEIPT_NAME),
      JSON.stringify({
        schemaVersion: 1,
        activeGeneration: 'gen-fixture-unloadable',
        apiVersion: ADAPTER_API_VERSION,
        source,
      }),
    )

    const inspection = await inspectInstalledAdapter('my-adapter', baseDir)
    if (inspection.kind !== 'broken') expect.unreachable()
    if (inspection.reason.kind !== 'load-failed') expect.unreachable()
    expect(inspection.reason.failure.kind).toBe('import-failed')
  })
})

describe('inspectInstalledAdapter — unmanaged', () => {
  test('declared unmanaged bundle is compatible with best-effort repair', async () => {
    await placeAdapter('custom-thing', await makeBundle('custom-thing'), baseDir)
    const inspection = await inspectInstalledAdapter('custom-thing', baseDir)
    if (inspection.kind !== 'compatible') expect.unreachable()
    expect(inspection.managed).toBe(false)
    expect(inspection.repair).toEqual({ kind: 'unmanaged-name', name: 'custom-thing' })
  })

  test('unmanaged first-party name repairs via its catalog alias', async () => {
    await placeAdapter('opencode', await makeBundle('opencode', { apiVersion: null }), baseDir)
    const inspection = await inspectInstalledAdapter('opencode', baseDir)
    if (inspection.kind !== 'incompatible') expect.unreachable()
    expect(inspection.failure.kind).toBe('api-missing')
    expect(inspection.repair).toEqual({ kind: 'first-party-alias', alias: 'opencode' })
  })

  test('undeclared unmanaged bundle is incompatible (api-missing), not broken', async () => {
    await placeAdapter('legacy', await makeBundle('legacy', { apiVersion: null }), baseDir)
    const inspection = await inspectInstalledAdapter('legacy', baseDir)
    if (inspection.kind !== 'incompatible') expect.unreachable()
    expect(inspection.failure).toEqual({ kind: 'api-missing', adapter: 'legacy', supported: [ADAPTER_API_VERSION] })
  })

  test('malformed unmanaged declaration is incompatible (api-malformed)', async () => {
    await placeAdapter('malformed', await makeBundle('malformed', { apiVersion: '0.0.1' }), baseDir)
    const inspection = await inspectInstalledAdapter('malformed', baseDir)
    if (inspection.kind !== 'incompatible') expect.unreachable()
    expect(inspection.failure.kind).toBe('api-malformed')
  })

  test('invalid unmanaged export is broken', async () => {
    const dir = join(baseDir, 'not-an-adapter')
    await mkdir(dir, { recursive: true })
    await Bun.write(join(dir, 'adapter.js'), 'export const nope = 1')
    const inspection = await inspectInstalledAdapter('not-an-adapter', baseDir)
    if (inspection.kind !== 'broken') expect.unreachable()
    if (inspection.reason.kind !== 'load-failed') expect.unreachable()
    expect(inspection.reason.failure.kind).toBe('no-default-export')
  })
})

describe('loadInstalledAdapters — fail-closed aggregation', () => {
  test('all-compatible installations load successfully', async () => {
    await installManaged('alpha', await makeBundle('alpha'))
    await placeAdapter('beta', await makeBundle('beta'), baseDir)

    const result = await loadInstalledAdapters(baseDir)
    if (!result.ok) expect.unreachable()
    expect(result.adapters.map((adapter) => adapter.name)).toEqual(['alpha', 'beta'])
  })

  test('a single incompatible entry fails the whole load with all failures collected', async () => {
    await installManaged('good', await makeBundle('good'))
    await placeAdapter('legacy', await makeBundle('legacy', { apiVersion: null }), baseDir)
    const brokenDir = join(baseDir, 'shattered')
    await mkdir(brokenDir, { recursive: true })
    await Bun.write(join(brokenDir, 'adapter.js'), 'export const nope = 1')

    const result = await loadInstalledAdapters(baseDir)
    if (result.ok) expect.unreachable()
    expect(result.failures.map((failure) => [failure.name, failure.kind])).toEqual([
      ['legacy', 'incompatible'],
      ['shattered', 'broken'],
    ])
  })

  test('empty base dir loads zero adapters successfully', async () => {
    const result = await loadInstalledAdapters(baseDir)
    if (!result.ok) expect.unreachable()
    expect(result.adapters).toEqual([])
  })

  test('unique generation paths keep replaced adapters fresh within one process', async () => {
    await installManaged('fresh', await makeBundle('fresh', { marker: 'one' }))
    const first = await loadInstalledAdapters(baseDir)
    if (!first.ok) expect.unreachable()
    const firstMeta = first.adapters[0]?.buildAssetMetadata({})
    if (!firstMeta?.ok) expect.unreachable()
    expect(firstMeta.data.marker).toBe('one')

    await installManaged('fresh', await makeBundle('fresh', { marker: 'two' }))
    const second = await loadInstalledAdapters(baseDir)
    if (!second.ok) expect.unreachable()
    const secondMeta = second.adapters[0]?.buildAssetMetadata({})
    if (!secondMeta?.ok) expect.unreachable()
    // A flat overwrite would hit the dynamic-import cache and still
    // return 'one'; unique generation paths guarantee freshness.
    expect(secondMeta.data.marker).toBe('two')
  })
})

describe('inspectInstalledAdapters — enumeration', () => {
  test('returns sorted inspections and ignores staging leftovers', async () => {
    await installManaged('bravo', await makeBundle('bravo'))
    await placeAdapter('alpha', await makeBundle('alpha'), baseDir)
    const leftover = join(baseDir, 'ghost', GENERATIONS_DIR_NAME, 'gen-crash')
    await mkdir(leftover, { recursive: true })

    const inspections = await inspectInstalledAdapters(baseDir)
    expect(inspections.map((inspection) => inspection.name)).toEqual(['alpha', 'bravo'])
  })
})
