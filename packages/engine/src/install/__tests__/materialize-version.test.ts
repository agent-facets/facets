/**
 * Tests for the per-version materialization chain (`materializeVersion`).
 *
 * All hash computation is REAL — fixtures are built on disk, their
 * genuine content hashes and canonical-tar integrity are computed via
 * `computeDirIntegrity`, and cache slots are seeded through the real
 * `cachePutVerified`. Only `downloadAndExtractFacet` (network I/O) is
 * stubbed via `mock.module`, following the established harness pattern.
 *
 * Covers all four input variants, tampered-hit eviction, the miss
 * path's genuine recompute (Check C with teeth), the locked-miss
 * lockfile check, and the cache-tampered retry contract.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LegacyBuildManifest } from '@agent-facets/protocol'
import type { CacheIdentity } from '../../cache/types.ts'
import type { RegistryMetadata, RegistryResult } from '../../registry/types.ts'

// --- Download stub (mutated per-test) --------------------------------------

type DownloadStub = (
  meta: RegistryMetadata,
  dest: string,
) => Promise<RegistryResult<{ integrity: string; fileHashes: Record<string, string> }>>
let downloadStub: DownloadStub = async () => ({
  ok: false,
  error: { code: 'NETWORK_ERROR', cause: 'no download stub configured', attempts: 1 },
})
let downloadCalls: Array<{ name: string; version: string }> = []

mock.module('../../registry/download.ts', () => ({
  downloadAndExtractFacet: async (meta: RegistryMetadata, dest: string) => {
    downloadCalls.push({ name: meta.name, version: meta.version })
    return downloadStub(meta, dest)
  },
}))

const { materializeVersion } = await import('../materialize-version/index.ts')
const { cachePath, cachePutVerified, cacheStagingDir, computeDirIntegrity, readCachedIntegrity } = await import(
  '../../cache/index.ts'
)

// --- Fixture helpers --------------------------------------------------------

interface Content {
  dir: string
  manifest: LegacyBuildManifest
  integrity: string
}

/** Build a real facet content tree and its genuine build manifest. */
function makeContent(parent: string, name: string, version: string, skillBody?: string): Content {
  const dir = realpathSync(mkdtempSync(join(parent, 'content-')))
  const facetJson = JSON.stringify({ name, version, skills: { planning: { description: 'planning skill' } } })
  writeFileSync(join(dir, 'facet.json'), facetJson)
  mkdirSync(join(dir, 'skills/planning'), { recursive: true })
  writeFileSync(join(dir, 'skills/planning/SKILL.md'), skillBody ?? `# planning ${version}\n`)
  const computed = computeDirIntegrity(dir, ['facet.json', 'skills/planning/SKILL.md'])
  if (!computed.ok) throw new Error('test bug: fixture content unreadable')
  const manifest: LegacyBuildManifest = {
    facetVersion: 0.1,
    archive: 'archive.tar.gz',
    integrity: computed.integrity,
    assets: computed.assetHashes,
  }
  return { dir, manifest, integrity: computed.integrity }
}

/** Seed a real registry cache slot via the verified-put path. */
function seedSlot(name: string, version: string): { slotPath: string; integrity: string } {
  const staging = cacheStagingDir()
  const content = makeContent(staging, name, version)
  const id: CacheIdentity = { kind: 'registry', name, version }
  const put = cachePutVerified(
    id,
    content.dir,
    { integrity: content.manifest.integrity, fileHashes: content.manifest.assets },
    content.integrity,
    name,
  )
  if (!put.ok) throw new Error('test bug: seeding cache slot failed')
  return { slotPath: put.path, integrity: content.integrity }
}

/** Configure the download stub to deliver `content` for any request. */
function stubDownload(content: Content): void {
  downloadStub = async (_meta, dest) => {
    cpSync(content.dir, dest, { recursive: true })
    return { ok: true, value: { integrity: content.manifest.integrity, fileHashes: content.manifest.assets } }
  }
}

let fakeHome: string
let originalHome: string | undefined
let originalFacetDir: string | undefined

beforeEach(() => {
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-matver-')))
  process.env.HOME = fakeHome
  process.env.FACET_DIR = join(fakeHome, '.facet')
  downloadStub = async () => ({
    ok: false,
    error: { code: 'NETWORK_ERROR', cause: 'no download stub configured', attempts: 1 },
  })
  downloadCalls = []
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  rmSync(fakeHome, { recursive: true, force: true })
})

// --- Hit paths ---------------------------------------------------------------

describe('materializeVersion — locked-hit', () => {
  test('passes when audited integrity equals the locked integrity (fully offline)', async () => {
    const { slotPath, integrity } = seedSlot('cowsay', '0.1.0')

    const result = await materializeVersion({
      kind: 'locked-hit',
      facetName: 'cowsay',
      version: '0.1.0',
      slotPath,
      lockfileIntegrity: integrity,
    })

    if (!result.ok) expect.unreachable()
    expect(result.slotPath).toBe(slotPath)
    expect(result.integrity).toBe(integrity)
    // Fully offline: the download stub was never invoked.
    expect(downloadCalls).toEqual([])
  })

  test('returns lockfile-mismatch when the locked integrity differs — slot is NOT evicted', async () => {
    const { slotPath, integrity } = seedSlot('cowsay', '0.1.0')
    const wrongLocked = 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

    const result = await materializeVersion({
      kind: 'locked-hit',
      facetName: 'cowsay',
      version: '0.1.0',
      slotPath,
      lockfileIntegrity: wrongLocked,
    })

    if (result.ok) expect.unreachable()
    if (result.code !== 'lockfile-mismatch') expect.unreachable()
    expect(result.expected).toBe(wrongLocked)
    expect(result.observed).toBe(integrity)
    // The content audited clean against ITS sidecar; the disagreement is
    // with the lockfile. The slot stays (a hard failure, not self-healing).
    expect(existsSync(slotPath)).toBe(true)
  })

  test('returns cache-tampered and evicts the slot when asset bytes were modified', async () => {
    const { slotPath, integrity } = seedSlot('cowsay', '0.1.0')
    // Tamper with content while leaving the sidecar intact.
    writeFileSync(join(slotPath, 'skills/planning/SKILL.md'), '# tampered\n')

    const result = await materializeVersion({
      kind: 'locked-hit',
      facetName: 'cowsay',
      version: '0.1.0',
      slotPath,
      lockfileIntegrity: integrity,
    })

    if (result.ok) expect.unreachable()
    expect(result.code).toBe('cache-tampered')
    // Evicted: the slot no longer exists, so a retry sees a miss.
    expect(existsSync(slotPath)).toBe(false)
  })

  test('returns cache-tampered and evicts when the sidecar is missing', async () => {
    const { slotPath, integrity } = seedSlot('cowsay', '0.1.0')
    rmSync(join(slotPath, 'cache-integrity.json'))

    const result = await materializeVersion({
      kind: 'locked-hit',
      facetName: 'cowsay',
      version: '0.1.0',
      slotPath,
      lockfileIntegrity: integrity,
    })

    if (result.ok) expect.unreachable()
    expect(result.code).toBe('cache-tampered')
    expect(existsSync(slotPath)).toBe(false)
  })
})

describe('materializeVersion — confirming-hit', () => {
  test('passes when audited integrity equals the registry fingerprint', async () => {
    const { slotPath, integrity } = seedSlot('cowsay', '0.1.0')

    const result = await materializeVersion({
      kind: 'confirming-hit',
      facetName: 'cowsay',
      version: '0.1.0',
      slotPath,
      contentFingerprint: integrity,
    })

    if (!result.ok) expect.unreachable()
    expect(result.integrity).toBe(integrity)
    expect(downloadCalls).toEqual([])
  })

  test('returns confirmation-mismatch when the registry fingerprint differs — slot is NOT evicted', async () => {
    const { slotPath, integrity } = seedSlot('cowsay', '0.1.0')
    const wrongFingerprint = 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

    const result = await materializeVersion({
      kind: 'confirming-hit',
      facetName: 'cowsay',
      version: '0.1.0',
      slotPath,
      contentFingerprint: wrongFingerprint,
    })

    if (result.ok) expect.unreachable()
    if (result.code !== 'confirmation-mismatch') expect.unreachable()
    expect(result.expected).toBe(wrongFingerprint)
    expect(result.observed).toBe(integrity)
    expect(existsSync(slotPath)).toBe(true)
  })
})

// --- Miss paths ---------------------------------------------------------------

describe('materializeVersion — confirming-miss', () => {
  test('downloads, genuinely recomputes, three-checks, and populates the cache', async () => {
    const content = makeContent(fakeHome, 'cowsay', '0.2.0')
    stubDownload(content)

    const result = await materializeVersion({
      kind: 'confirming-miss',
      facetName: 'cowsay',
      version: '0.2.0',
      transportHash: 'sha256:stub-transport',
      contentFingerprint: content.integrity,
    })

    if (!result.ok) expect.unreachable()
    expect(result.integrity).toBe(content.integrity)
    expect(downloadCalls).toEqual([{ name: 'cowsay', version: '0.2.0' }])
    // The slot exists with a valid sidecar recording the verified integrity.
    const slotPath = cachePath({ kind: 'registry', name: 'cowsay', version: '0.2.0' })
    expect(result.slotPath).toBe(slotPath)
    const sidecar = readCachedIntegrity(slotPath)
    if (sidecar === null) expect.unreachable()
    expect(sidecar.integrity).toBe(content.integrity)
  })

  test('genuine recompute: tampered bytes whose manifest still claims the original integrity fail Check C', async () => {
    // Build clean content, then a tampered tree that reuses the CLEAN
    // manifest (claimed integrity + claimed asset hashes are for the
    // original content; the delivered bytes differ). The old fake
    // recompute (computedIntegrity = manifest claim) would have passed
    // Check C unconditionally; the genuine recompute must fail it.
    const clean = makeContent(fakeHome, 'cowsay', '0.2.0')
    const tampered = makeContent(fakeHome, 'cowsay', '0.2.0', '# tampered payload\n')
    stubDownload({ dir: tampered.dir, manifest: clean.manifest, integrity: clean.integrity })

    const result = await materializeVersion({
      kind: 'confirming-miss',
      facetName: 'cowsay',
      version: '0.2.0',
      transportHash: 'sha256:stub-transport',
      contentFingerprint: clean.integrity,
    })

    if (result.ok) expect.unreachable()
    if (result.code !== 'integrity-failed') expect.unreachable()
    if (result.failure.kind !== 'facet') expect.unreachable()
    expect(result.failure.check).toBe('C')
    // Tampered content never reaches the cache.
    expect(existsSync(cachePath({ kind: 'registry', name: 'cowsay', version: '0.2.0' }))).toBe(false)
  })

  test('Check B: registry fingerprint disagreeing with the manifest claim fails closed', async () => {
    const content = makeContent(fakeHome, 'cowsay', '0.2.0')
    stubDownload(content)

    const result = await materializeVersion({
      kind: 'confirming-miss',
      facetName: 'cowsay',
      version: '0.2.0',
      transportHash: 'sha256:stub-transport',
      contentFingerprint: 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    })

    if (result.ok) expect.unreachable()
    if (result.code !== 'integrity-failed') expect.unreachable()
    if (result.failure.kind !== 'facet') expect.unreachable()
    expect(result.failure.check).toBe('B')
  })

  test('a manifest listing an asset the download did not deliver fails as an asset integrity failure', async () => {
    const content = makeContent(fakeHome, 'cowsay', '0.2.0')
    const manifestWithGhost: LegacyBuildManifest = {
      ...content.manifest,
      assets: {
        ...content.manifest.assets,
        'skills/planning/MISSING.md': 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      },
    }
    stubDownload({ dir: content.dir, manifest: manifestWithGhost, integrity: content.integrity })

    const result = await materializeVersion({
      kind: 'confirming-miss',
      facetName: 'cowsay',
      version: '0.2.0',
      transportHash: 'sha256:stub-transport',
      contentFingerprint: content.integrity,
    })

    if (result.ok) expect.unreachable()
    if (result.code !== 'integrity-failed') expect.unreachable()
    if (result.failure.kind !== 'asset') expect.unreachable()
    expect(result.failure.path).toBe('skills/planning/MISSING.md')
    expect(result.failure.observed).toBe('<missing>')
  })

  test('download failure surfaces as download-failed', async () => {
    const result = await materializeVersion({
      kind: 'confirming-miss',
      facetName: 'cowsay',
      version: '0.2.0',
      transportHash: 'sha256:stub-transport',
      contentFingerprint: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    })

    if (result.ok) expect.unreachable()
    if (result.code !== 'download-failed') expect.unreachable()
    expect(result.error.code).toBe('NETWORK_ERROR')
  })
})

describe('materializeVersion — locked-miss', () => {
  test('passes when fingerprint, manifest, recompute, and lockfile all agree', async () => {
    const content = makeContent(fakeHome, 'cowsay', '0.2.0')
    stubDownload(content)

    const result = await materializeVersion({
      kind: 'locked-miss',
      facetName: 'cowsay',
      version: '0.2.0',
      transportHash: 'sha256:stub-transport',
      contentFingerprint: content.integrity,
      lockfileIntegrity: content.integrity,
    })

    if (!result.ok) expect.unreachable()
    expect(result.integrity).toBe(content.integrity)
  })

  test('a locked integrity disagreeing with the registry fingerprint fails the lockfile check first', async () => {
    const content = makeContent(fakeHome, 'cowsay', '0.2.0')
    stubDownload(content)

    const result = await materializeVersion({
      kind: 'locked-miss',
      facetName: 'cowsay',
      version: '0.2.0',
      transportHash: 'sha256:stub-transport',
      contentFingerprint: content.integrity,
      lockfileIntegrity: 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    })

    if (result.ok) expect.unreachable()
    if (result.code !== 'integrity-failed') expect.unreachable()
    if (result.failure.kind !== 'facet') expect.unreachable()
    expect(result.failure.check).toBe('lockfile')
    // The mismatching content never populates the cache.
    expect(existsSync(cachePath({ kind: 'registry', name: 'cowsay', version: '0.2.0' }))).toBe(false)
  })
})

// --- The retry contract -------------------------------------------------------

describe('materializeVersion — cache-tampered retry contract', () => {
  test('after cache-tampered the slot is evicted, so a miss-variant retry succeeds', async () => {
    const { slotPath, integrity } = seedSlot('cowsay', '0.1.0')
    writeFileSync(join(slotPath, 'skills/planning/SKILL.md'), '# tampered\n')

    const first = await materializeVersion({
      kind: 'locked-hit',
      facetName: 'cowsay',
      version: '0.1.0',
      slotPath,
      lockfileIntegrity: integrity,
    })
    if (first.ok) expect.unreachable()
    expect(first.code).toBe('cache-tampered')
    expect(existsSync(slotPath)).toBe(false)

    // Retry as a miss: a clean download repopulates the slot and passes.
    const content = makeContent(fakeHome, 'cowsay', '0.1.0')
    stubDownload(content)
    const second = await materializeVersion({
      kind: 'locked-miss',
      facetName: 'cowsay',
      version: '0.1.0',
      transportHash: 'sha256:stub-transport',
      contentFingerprint: content.integrity,
      lockfileIntegrity: content.integrity,
    })

    if (!second.ok) expect.unreachable()
    expect(second.slotPath).toBe(slotPath)
    expect(existsSync(slotPath)).toBe(true)
  })
})
