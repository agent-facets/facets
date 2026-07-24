import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import { acquireAdapterLock } from '../../install/lockfile-guard.ts'
import {
  GENERATIONS_DIR_NAME,
  INSTALLATION_RECEIPT_NAME,
  type InstallationSource,
  readInstallationReceipt,
} from '../installation.ts'
import { listInstalledAdapters, placeAdapter, placeAdapterManaged, removeAdapter } from '../placement.ts'

/**
 * Managed placement tests: atomic activation, failure injection at every
 * stage (proving the previous installation survives untouched), cleanup
 * warnings, stale leftovers, concurrent replacement, legacy conversion,
 * and the new removal/enumeration semantics.
 */

let facetDir: string
let baseDir: string
let workDir: string
let originalFacetDir: string | undefined

beforeEach(async () => {
  facetDir = await mkdtemp(join(tmpdir(), 'facet-place-managed-'))
  baseDir = join(facetDir, 'adapters')
  workDir = await mkdtemp(join(tmpdir(), 'facet-place-work-'))
  originalFacetDir = process.env.FACET_DIR
  // Locks live under $FACET_DIR/locks — redirect them per test.
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
/** Write a dependency-free verifiable bundle; unique file per call. */
async function makeBundle(name: string, opts: { apiVersion?: string; marker?: string } = {}): Promise<string> {
  const api = opts.apiVersion ?? ADAPTER_API_VERSION
  const path = join(workDir, `bundle-${++bundleCounter}.mjs`)
  await Bun.write(
    path,
    `export const marker = '${opts.marker ?? 'default'}'
export default {
  name: '${name}',
  apiVersion: '${api}',
  buildAssetMetadata: () => ({ ok: true, data: {} }),
  installAsset: async () => undefined,
  readAsset: async () => ({ content: '' }),
  deleteAsset: async () => undefined,
}
`,
  )
  return path
}

const npmSource: InstallationSource = {
  kind: 'npm',
  specifier: 'my-adapter',
  packageName: 'my-adapter',
  version: '1.0.0',
  integrity: { kind: 'sri', value: 'sha512-test' },
}

async function generationNames(name: string): Promise<string[]> {
  try {
    return (await readdir(join(baseDir, name, GENERATIONS_DIR_NAME))).sort()
  } catch {
    return []
  }
}

describe('placeAdapterManaged — success paths', () => {
  test('fresh install writes an active generation and receipt', async () => {
    const bundle = await makeBundle('my-adapter')
    const result = await placeAdapterManaged(
      'my-adapter',
      bundle,
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (!result.ok) expect.unreachable()
    expect(result.warnings).toEqual([])
    expect(result.receipt.apiVersion).toBe(ADAPTER_API_VERSION)
    expect(result.receipt.source).toEqual(npmSource)

    const read = await readInstallationReceipt(join(baseDir, 'my-adapter'))
    if (!read.ok) expect.unreachable()
    expect(read.receipt).toEqual(result.receipt)

    const generations = await generationNames('my-adapter')
    expect(generations).toEqual([result.receipt.activeGeneration])
    expect(
      await Bun.file(
        join(baseDir, 'my-adapter', GENERATIONS_DIR_NAME, result.receipt.activeGeneration, 'adapter.js'),
      ).exists(),
    ).toBe(true)
  })

  test('replacement activates a new generation and removes the old one', async () => {
    const first = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter', { marker: 'one' }),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (!first.ok) expect.unreachable()

    const second = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter', { marker: 'two' }),
      { apiVersion: ADAPTER_API_VERSION, source: { ...npmSource, version: '2.0.0' } },
      baseDir,
    )
    if (!second.ok) expect.unreachable()
    expect(second.receipt.activeGeneration).not.toBe(first.receipt.activeGeneration)
    expect(await generationNames('my-adapter')).toEqual([second.receipt.activeGeneration])

    const read = await readInstallationReceipt(join(baseDir, 'my-adapter'))
    if (!read.ok) expect.unreachable()
    if (read.receipt.source.kind !== 'npm') expect.unreachable()
    expect(read.receipt.source.version).toBe('2.0.0')
  })

  test('successful install converts a legacy flat bundle to managed', async () => {
    await placeAdapter('my-adapter', await makeBundle('my-adapter', { marker: 'legacy' }), baseDir)
    const legacyPath = join(baseDir, 'my-adapter', 'adapter.js')
    expect(await Bun.file(legacyPath).exists()).toBe(true)

    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter', { marker: 'managed' }),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (!result.ok) expect.unreachable()
    expect(await Bun.file(legacyPath).exists()).toBe(false)
    const read = await readInstallationReceipt(join(baseDir, 'my-adapter'))
    expect(read.ok).toBe(true)
  })

  test('successful install cleans stale crash leftovers', async () => {
    // A crash between staging and activation leaves an orphaned generation.
    const leftover = join(baseDir, 'my-adapter', GENERATIONS_DIR_NAME, 'gen-crash-leftover')
    await mkdir(leftover, { recursive: true })
    await Bun.write(join(leftover, 'adapter.js'), '// stale')

    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter'),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (!result.ok) expect.unreachable()
    expect(await generationNames('my-adapter')).toEqual([result.receipt.activeGeneration])
  })
})

describe('placeAdapterManaged — failure injection', () => {
  /** Install a good managed version, returning its receipt for later comparison. */
  async function installGood(): Promise<{ activeGeneration: string; receiptText: string }> {
    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter', { marker: 'good' }),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (!result.ok) expect.unreachable()
    const receiptText = await Bun.file(join(baseDir, 'my-adapter', INSTALLATION_RECEIPT_NAME)).text()
    return { activeGeneration: result.receipt.activeGeneration, receiptText }
  }

  async function expectUntouched(previous: { activeGeneration: string; receiptText: string }): Promise<void> {
    expect(await Bun.file(join(baseDir, 'my-adapter', INSTALLATION_RECEIPT_NAME)).text()).toBe(previous.receiptText)
    expect(await generationNames('my-adapter')).toEqual([previous.activeGeneration])
  }

  test('stage failure (missing bundle) leaves the previous installation untouched', async () => {
    const previous = await installGood()
    const result = await placeAdapterManaged(
      'my-adapter',
      join(workDir, 'does-not-exist.mjs'),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (result.ok) expect.unreachable()
    expect(result.failure.kind).toBe('stage-failed')
    await expectUntouched(previous)
  })

  test('verification failure at the staged path leaves the previous installation untouched', async () => {
    const previous = await installGood()
    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter', { apiVersion: '9.9' }),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'verify-failed') expect.unreachable()
    expect(result.failure.failure.kind).toBe('incompatible')
    await expectUntouched(previous)
  })

  test('metadata/runtime disagreement at the staged path is terminal', async () => {
    const previous = await installGood()
    // Runtime declares the supported API but provenance claims the
    // superseded 0.0 — the staged re-verification must reject the
    // contradiction (0.0 is unsupported, so support check fires first).
    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter'),
      { apiVersion: '0.0', source: npmSource },
      baseDir,
    )
    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'verify-failed') expect.unreachable()
    expect(result.failure.failure.kind).toBe('incompatible')
    await expectUntouched(previous)
  })

  test('runtime name mismatch leaves the previous installation untouched', async () => {
    const previous = await installGood()
    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('other-name'),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'name-mismatch') expect.unreachable()
    expect(result.failure.runtimeName).toBe('other-name')
    await expectUntouched(previous)
  })

  test('receipt-write failure leaves the previous installation untouched', async () => {
    const previous = await installGood()
    // atomicWriteFileSync writes to `<receipt>.tmp` first; making that
    // path a directory forces the write to fail after staging.
    await mkdir(join(baseDir, 'my-adapter', `${INSTALLATION_RECEIPT_NAME}.tmp`), { recursive: true })
    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter', { marker: 'unactivatable' }),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    await rm(join(baseDir, 'my-adapter', `${INSTALLATION_RECEIPT_NAME}.tmp`), { recursive: true, force: true })
    if (result.ok) expect.unreachable()
    expect(result.failure.kind).toBe('receipt-write-failed')
    await expectUntouched(previous)
  })

  test('lock-file I/O failure returns a structured lock-io failure, not a rejection', async () => {
    const previous = await installGood()
    // Occupy the locks path with a regular file so lock-directory
    // creation fails deterministically (no chmod, root-safe).
    const locksPath = join(facetDir, 'locks')
    await rm(locksPath, { recursive: true, force: true })
    await Bun.write(locksPath, 'not a directory')
    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter'),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'lock-io') expect.unreachable()
    expect(result.failure.adapter).toBe('my-adapter')
    expect(result.failure.lockPath).toContain(locksPath)
    expect(result.failure.cause).not.toBe('')
    await expectUntouched(previous)
  })

  test('concurrent replacement is refused while the adapter lock is held', async () => {
    const lock = acquireAdapterLock('my-adapter')
    if (!lock.ok) expect.unreachable()
    try {
      const result = await placeAdapterManaged(
        'my-adapter',
        await makeBundle('my-adapter'),
        { apiVersion: ADAPTER_API_VERSION, source: npmSource },
        baseDir,
      )
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'lock-held') expect.unreachable()
      expect(result.failure.heldByPid).toBe(process.pid)
    } finally {
      await lock.lock.release()
    }
  })

  test('undeletable old generation degrades to a cleanup warning, not a failure', async () => {
    const previous = await installGood()
    const oldGenDir = join(baseDir, 'my-adapter', GENERATIONS_DIR_NAME, previous.activeGeneration)
    // Remove write permission so the old generation's contents can't be unlinked.
    await chmod(oldGenDir, 0o555)
    try {
      const result = await placeAdapterManaged(
        'my-adapter',
        await makeBundle('my-adapter', { marker: 'new' }),
        { apiVersion: ADAPTER_API_VERSION, source: npmSource },
        baseDir,
      )
      if (!result.ok) expect.unreachable()
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]?.kind).toBe('cleanup-failed')
      // Activation still succeeded: the receipt points at the new generation.
      const read = await readInstallationReceipt(join(baseDir, 'my-adapter'))
      if (!read.ok) expect.unreachable()
      expect(read.receipt.activeGeneration).not.toBe(previous.activeGeneration)
    } finally {
      await chmod(oldGenDir, 0o755).catch(() => {})
    }
  })
})

describe('removal and enumeration semantics', () => {
  test('removeAdapter deletes a managed installation without loading it', async () => {
    const result = await placeAdapterManaged(
      'my-adapter',
      await makeBundle('my-adapter'),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (!result.ok) expect.unreachable()
    expect(await removeAdapter('my-adapter', baseDir)).toBe(true)
    expect(await Bun.file(join(baseDir, 'my-adapter', INSTALLATION_RECEIPT_NAME)).exists()).toBe(false)
  })

  test('removeAdapter deletes a legacy flat installation', async () => {
    await placeAdapter('legacy-adapter', await makeBundle('legacy-adapter'), baseDir)
    expect(await removeAdapter('legacy-adapter', baseDir)).toBe(true)
  })

  test('removeAdapter ignores a staging-leftover-only directory', async () => {
    const leftover = join(baseDir, 'ghost', GENERATIONS_DIR_NAME, 'gen-crash')
    await mkdir(leftover, { recursive: true })
    await Bun.write(join(leftover, 'adapter.js'), '// stale')
    expect(await removeAdapter('ghost', baseDir)).toBe(false)
    expect(await Bun.file(join(leftover, 'adapter.js')).exists()).toBe(true)
  })

  test('removeAdapter returns false for a nonexistent adapter', async () => {
    expect(await removeAdapter('nope', baseDir)).toBe(false)
  })

  test('listInstalledAdapters lists managed and legacy entries, ignoring leftovers', async () => {
    const placed = await placeAdapterManaged(
      'managed-one',
      await makeBundle('managed-one'),
      { apiVersion: ADAPTER_API_VERSION, source: npmSource },
      baseDir,
    )
    if (!placed.ok) expect.unreachable()
    await placeAdapter('legacy-one', await makeBundle('legacy-one'), baseDir)
    const leftover = join(baseDir, 'ghost', GENERATIONS_DIR_NAME, 'gen-crash')
    await mkdir(leftover, { recursive: true })

    expect(await listInstalledAdapters(baseDir)).toEqual(['legacy-one', 'managed-one'])
  })
})
