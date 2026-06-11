import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuildManifest } from '@agent-facets/protocol'
import { assembleTar, computeContentHash } from '@agent-facets/protocol'
import {
  auditCacheSlot,
  CACHE_INTEGRITY_FILE,
  type CacheIdentity,
  type CacheIntegrity,
  cacheGet,
  cachePath,
  cachePut,
  cachePutVerified,
  cacheSlot,
  cacheSlotIsDir,
  cacheStagingDir,
  evictCacheSlot,
  readCachedIntegrity,
  resolveCacheRoot,
} from '../cache/index.ts'

let cacheDir: string
let originalEnv: string | undefined

// Note: `FACET_DIR` is the single source of truth for all facet-managed
// directories. Setting it in these tests redirects the entire tree (cache,
// adapters, locks, bin) to the temp dir — only the `cache/` subdirectory
// is exercised here, but the redirection is global.
let facetDir: string

beforeEach(() => {
  originalEnv = process.env.FACET_DIR
  facetDir = mkdtempSync(join(tmpdir(), 'facet-cache-test-'))
  cacheDir = join(facetDir, 'cache')
  process.env.FACET_DIR = facetDir
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.FACET_DIR
  } else {
    process.env.FACET_DIR = originalEnv
  }
  rmSync(facetDir, { recursive: true, force: true })
})

describe('resolveCacheRoot', () => {
  test('uses $FACET_DIR/cache when FACET_DIR is set', () => {
    expect(resolveCacheRoot()).toBe(cacheDir)
  })

  test('treats whitespace-only FACET_DIR as unset', () => {
    process.env.FACET_DIR = '   '
    const result = resolveCacheRoot()
    expect(result).not.toBe('   ')
    expect(result.endsWith(join('.facet', 'cache'))).toBe(true)
  })

  test('treats empty FACET_DIR as unset', () => {
    process.env.FACET_DIR = ''
    const result = resolveCacheRoot()
    expect(result.endsWith(join('.facet', 'cache'))).toBe(true)
  })
})

describe('cacheSlot', () => {
  test('registry slot uses name@version', () => {
    expect(cacheSlot({ kind: 'registry', name: 'viper-plans', version: '1.2.3' })).toBe('viper-plans@1.2.3')
  })

  test('git slot uses name@version', () => {
    expect(cacheSlot({ kind: 'git', name: 'viper-plans', version: '1.2.3' })).toBe('viper-plans@1.2.3')
  })

  test('local slot uses name@local-<hash>', () => {
    const slot = cacheSlot({ kind: 'local', name: 'viper-plans', absolutePath: '/abs/path' })
    expect(slot).toMatch(/^viper-plans@local-[0-9a-f]{8}$/)
  })

  test('different local paths produce different slots', () => {
    const a = cacheSlot({ kind: 'local', name: 'p', absolutePath: '/a' })
    const b = cacheSlot({ kind: 'local', name: 'p', absolutePath: '/b' })
    expect(a).not.toBe(b)
  })

  test('same local path is deterministic', () => {
    const a = cacheSlot({ kind: 'local', name: 'p', absolutePath: '/abs' })
    const b = cacheSlot({ kind: 'local', name: 'p', absolutePath: '/abs' })
    expect(a).toBe(b)
  })
})

describe('cachePath', () => {
  test('joins cache root and slot', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'viper-plans', version: '1.2.3' }
    expect(cachePath(id)).toBe(join(cacheDir, 'viper-plans@1.2.3'))
  })

  test('different identities produce different paths', () => {
    const a = cachePath({ kind: 'registry', name: 'p', version: '1.0.0' })
    const b = cachePath({ kind: 'registry', name: 'p', version: '2.0.0' })
    expect(a).not.toBe(b)
  })
})

describe('cacheGet', () => {
  test('miss returns hit:false with target path', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const result = cacheGet(id)
    expect(result.hit).toBe(false)
    expect(result.path).toBe(cachePath(id))
  })

  test('hit returns hit:true after the slot is populated', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(cachePath(id), { recursive: true })
    const result = cacheGet(id)
    expect(result.hit).toBe(true)
    expect(result.path).toBe(cachePath(id))
  })

  test('miss when slot path is a file, not a directory', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(resolveCacheRoot(), { recursive: true })
    writeFileSync(cachePath(id), 'oops')
    const result = cacheGet(id)
    expect(result.hit).toBe(false)
    expect(result.path).toBe(cachePath(id))
  })
})

describe('cachePut', () => {
  test('moves a populated staging dir into the cache slot', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const staging = cacheStagingDir()
    writeFileSync(join(staging, 'facet.json'), '{"name":"p","version":"1.0.0"}')
    writeFileSync(join(staging, 'README.md'), '# p')
    const result = cachePut(id, staging)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.path).toBe(cachePath(id))
    expect(existsSync(staging)).toBe(false)
    expect(cacheSlotIsDir(id)).toBe(true)
    expect(existsSync(join(result.path, 'facet.json'))).toBe(true)
    expect(existsSync(join(result.path, 'README.md'))).toBe(true)
  })

  test('concurrent put: existing slot wins, loser is cleaned up', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const winner = cacheStagingDir()
    writeFileSync(join(winner, 'marker.txt'), 'winner')
    expect(cachePut(id, winner).ok).toBe(true)

    const loser = cacheStagingDir()
    writeFileSync(join(loser, 'marker.txt'), 'loser')
    const result = cachePut(id, loser)

    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.path).toBe(cachePath(id))
    expect(existsSync(loser)).toBe(false)
    expect(readFileSync(join(cachePath(id), 'marker.txt'), 'utf8')).toBe('winner')
  })

  test('returns corruption result when slot path is a file, leaving staging intact', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(resolveCacheRoot(), { recursive: true })
    writeFileSync(cachePath(id), 'oops')

    const staging = cacheStagingDir()
    writeFileSync(join(staging, 'marker.txt'), 'mine')

    const result = cachePut(id, staging)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.corruption.entryKind).toBe('file')
    expect(result.corruption.slotPath).toBe(cachePath(id))
    // Caller's staged content must not be silently consumed.
    expect(existsSync(staging)).toBe(true)
    expect(readFileSync(join(staging, 'marker.txt'), 'utf8')).toBe('mine')

    rmSync(staging, { recursive: true, force: true })
  })

  test('puts for distinct identities do not collide', () => {
    const a: CacheIdentity = { kind: 'registry', name: 'a', version: '1.0.0' }
    const b: CacheIdentity = { kind: 'registry', name: 'b', version: '1.0.0' }
    const stagingA = cacheStagingDir()
    writeFileSync(join(stagingA, 'name.txt'), 'a')
    const stagingB = cacheStagingDir()
    writeFileSync(join(stagingB, 'name.txt'), 'b')
    expect(cachePut(a, stagingA).ok).toBe(true)
    expect(cachePut(b, stagingB).ok).toBe(true)
    expect(cacheSlotIsDir(a)).toBe(true)
    expect(cacheSlotIsDir(b)).toBe(true)
  })

  test('local-source slots disambiguate by absolute path', () => {
    const a: CacheIdentity = { kind: 'local', name: 'p', absolutePath: '/path/a' }
    const b: CacheIdentity = { kind: 'local', name: 'p', absolutePath: '/path/b' }
    const stagingA = cacheStagingDir()
    writeFileSync(join(stagingA, 'mark.txt'), 'a')
    const stagingB = cacheStagingDir()
    writeFileSync(join(stagingB, 'mark.txt'), 'b')
    expect(cachePut(a, stagingA).ok).toBe(true)
    expect(cachePut(b, stagingB).ok).toBe(true)
    expect(cachePath(a)).not.toBe(cachePath(b))
    expect(cacheSlotIsDir(a)).toBe(true)
    expect(cacheSlotIsDir(b)).toBe(true)
  })

  test('cacheStagingDir produces unique paths', () => {
    const a = cacheStagingDir()
    const b = cacheStagingDir()
    expect(a).not.toBe(b)
    rmSync(a, { recursive: true, force: true })
    rmSync(b, { recursive: true, force: true })
  })
})

describe('cacheSlotIsDir', () => {
  test('false when slot does not exist', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    expect(cacheSlotIsDir(id)).toBe(false)
  })

  test('true when slot is a populated directory', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(cachePath(id), { recursive: true })
    expect(cacheSlotIsDir(id)).toBe(true)
  })

  test('false when slot path is a file', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(resolveCacheRoot(), { recursive: true })
    writeFileSync(cachePath(id), 'oops')
    expect(cacheSlotIsDir(id)).toBe(false)
  })
})

/**
 * Build a real `BuildManifest` for the given files. Per-asset hashes
 * are computed honestly via `computeContentHash`. The top-level
 * `integrity` is a stable opaque value derived from the file set —
 * `cachePutVerified` does not recompute it; it only string-compares
 * against the caller-supplied `computedIntegrity`. Tests pass the
 * same value as `computedIntegrity` for the success case, or a
 * different value to exercise the facet-level mismatch arm.
 */
function buildManifestFor(staging: string, files: Record<string, string>): BuildManifest {
  const assets: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(staging, path)
    mkdirSync(join(fullPath, '..'), { recursive: true })
    writeFileSync(fullPath, content)
    assets[path] = computeContentHash(content)
  }
  // Stand-in for the canonical-archive hash. Tests don't care what
  // bytes produced it, only that manifest.integrity and the caller's
  // computedIntegrity argument agree (success) or disagree (failure).
  const integrity = computeContentHash(`fake-archive-${JSON.stringify(assets)}`)
  return {
    facetVersion: 0.1,
    archive: 'archive.tar.gz',
    integrity,
    assets,
  }
}

describe('cachePutVerified', () => {
  test('returns ok with sidecar written when manifest matches content and computedIntegrity matches', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const staging = cacheStagingDir()
    const manifest = buildManifestFor(staging, {
      'facet.json': '{"name":"p","version":"1.0.0"}',
      'skills/foo/SKILL.md': '# foo skill',
    })

    const result = cachePutVerified(id, staging, manifest, manifest.integrity, 'p')

    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.path).toBe(cachePath(id))
    expect(existsSync(staging)).toBe(false)
    expect(cacheSlotIsDir(id)).toBe(true)

    // Sidecar is present and parses to the expected shape.
    const sidecarRaw = readFileSync(join(result.path, CACHE_INTEGRITY_FILE), 'utf8')
    const sidecar = JSON.parse(sidecarRaw) as CacheIntegrity
    expect(sidecar.integrity).toBe(manifest.integrity)
    expect(sidecar.assets).toEqual(manifest.assets)
  })

  test('returns asset failure when an asset hash is wrong', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const staging = cacheStagingDir()
    const manifest = buildManifestFor(staging, {
      'facet.json': '{"name":"p","version":"1.0.0"}',
      'skills/foo/SKILL.md': '# foo skill',
    })
    // Tamper: rewrite the asset's recorded hash to a wrong value.
    const wrongHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    manifest.assets['facet.json'] = wrongHash

    const result = cachePutVerified(id, staging, manifest, manifest.integrity, 'p')

    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (!('integrity' in result)) expect.unreachable()
    expect(result.integrity.kind).toBe('asset')
    if (result.integrity.kind !== 'asset') expect.unreachable()
    expect(result.integrity.path).toBe('facet.json')
    expect(result.integrity.expected).toBe(wrongHash)
    expect(result.integrity.facet).toBe('p')

    // Cache slot was NOT created; staging is intact.
    expect(cacheSlotIsDir(id)).toBe(false)
    expect(existsSync(staging)).toBe(true)
  })

  test('returns asset failure when an asset file is missing', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const staging = cacheStagingDir()
    const manifest = buildManifestFor(staging, {
      'facet.json': '{"name":"p","version":"1.0.0"}',
    })
    // Tamper: claim an asset exists that never got written.
    manifest.assets['skills/missing/SKILL.md'] =
      'sha256:1111111111111111111111111111111111111111111111111111111111111111'

    const result = cachePutVerified(id, staging, manifest, manifest.integrity, 'p')

    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (!('integrity' in result)) expect.unreachable()
    expect(result.integrity.kind).toBe('asset')
    if (result.integrity.kind !== 'asset') expect.unreachable()
    expect(result.integrity.path).toBe('skills/missing/SKILL.md')
    expect(result.integrity.observed).toBe('<missing>')

    expect(cacheSlotIsDir(id)).toBe(false)
  })

  test('returns facet failure when computedIntegrity disagrees with manifest.integrity', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const staging = cacheStagingDir()
    const manifest = buildManifestFor(staging, {
      'facet.json': '{"name":"p","version":"1.0.0"}',
    })
    const wrongComputed = computeContentHash('different-archive-bytes')

    const result = cachePutVerified(id, staging, manifest, wrongComputed, 'p')

    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (!('integrity' in result)) expect.unreachable()
    expect(result.integrity.kind).toBe('facet')
    if (result.integrity.kind !== 'facet') expect.unreachable()
    expect(result.integrity.check).toBe('C')
    expect(result.integrity.expected).toBe(manifest.integrity)
    expect(result.integrity.observed).toBe(wrongComputed)

    expect(cacheSlotIsDir(id)).toBe(false)
    expect(existsSync(staging)).toBe(true)
  })

  test('forwards corruption result when slot path is a file', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(resolveCacheRoot(), { recursive: true })
    writeFileSync(cachePath(id), 'oops')

    const staging = cacheStagingDir()
    const manifest = buildManifestFor(staging, {
      'facet.json': '{"name":"p","version":"1.0.0"}',
    })

    const result = cachePutVerified(id, staging, manifest, manifest.integrity, 'p')

    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (!('corruption' in result)) expect.unreachable()
    expect(result.corruption.entryKind).toBe('file')
    expect(result.corruption.slotPath).toBe(cachePath(id))

    rmSync(staging, { recursive: true, force: true })
  })
})

describe('readCachedIntegrity', () => {
  test('round-trips after cachePutVerified', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const staging = cacheStagingDir()
    const manifest = buildManifestFor(staging, {
      'facet.json': '{"name":"p","version":"1.0.0"}',
      'skills/foo/SKILL.md': '# foo skill',
    })

    const result = cachePutVerified(id, staging, manifest, manifest.integrity, 'p')
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()

    const sidecar = readCachedIntegrity(result.path)
    expect(sidecar).not.toBeNull()
    if (sidecar === null) expect.unreachable()
    expect(sidecar.integrity).toBe(manifest.integrity)
    expect(sidecar.assets).toEqual(manifest.assets)
  })

  test('returns null when sidecar is missing', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(cachePath(id), { recursive: true })
    expect(readCachedIntegrity(cachePath(id))).toBeNull()
  })

  test('returns null on malformed JSON', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(cachePath(id), { recursive: true })
    writeFileSync(join(cachePath(id), CACHE_INTEGRITY_FILE), 'not json{')
    expect(readCachedIntegrity(cachePath(id))).toBeNull()
  })

  test('returns null on schema-invalid sidecar', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    mkdirSync(cachePath(id), { recursive: true })
    writeFileSync(join(cachePath(id), CACHE_INTEGRITY_FILE), JSON.stringify({ foo: 'bar' }))
    expect(readCachedIntegrity(cachePath(id))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// auditCacheSlot
// ---------------------------------------------------------------------------

describe('auditCacheSlot', () => {
  /** Populate a cache slot with known content and a matching sidecar. */
  function seedSlot(id: CacheIdentity, files: Record<string, string>): { slotPath: string; sidecar: CacheIntegrity } {
    const slotPath = cachePath(id)
    mkdirSync(slotPath, { recursive: true })
    const assets: Record<string, string> = {}
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(slotPath, path)
      mkdirSync(join(slotPath, path, '..'), { recursive: true })
      writeFileSync(fullPath, content)
      assets[path] = computeContentHash(content)
    }
    // Compute the canonical integrity from the sorted entries.
    const entries = Object.entries(files)
      .map(([path, content]) => ({ path, content }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const tarBytes = assembleTar(entries)
    const integrity = computeContentHash(tarBytes)
    const sidecar: CacheIntegrity = { integrity, assets }
    writeFileSync(join(slotPath, CACHE_INTEGRITY_FILE), JSON.stringify(sidecar, null, 2))
    return { slotPath, sidecar }
  }

  test('passes on untampered content', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'audit-ok', version: '1.0.0' }
    const { slotPath, sidecar } = seedSlot(id, {
      'facet.json': '{"name":"audit-ok","version":"1.0.0"}',
      'skills/hello/SKILL.md': '# Hello\n',
    })
    const result = auditCacheSlot(slotPath, sidecar)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.integrity).toBe(sidecar.integrity)
  })

  test('fails when an asset file is tampered', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'audit-tamper', version: '1.0.0' }
    const { slotPath, sidecar } = seedSlot(id, {
      'facet.json': '{"name":"audit-tamper","version":"1.0.0"}',
    })
    // Tamper the file after seeding.
    writeFileSync(join(slotPath, 'facet.json'), '{"name":"EVIL","version":"1.0.0"}')
    const result = auditCacheSlot(slotPath, sidecar)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('tampered')
  })

  test('fails when an asset file is missing', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'audit-miss', version: '1.0.0' }
    const { slotPath, sidecar } = seedSlot(id, {
      'facet.json': '{"name":"audit-miss","version":"1.0.0"}',
      'skills/hello/SKILL.md': '# Hello\n',
    })
    // Delete one file.
    rmSync(join(slotPath, 'skills/hello/SKILL.md'))
    const result = auditCacheSlot(slotPath, sidecar)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('tampered')
  })

  test('fails when the canonical archive hash disagrees with the sidecar', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'audit-canon', version: '1.0.0' }
    const { slotPath, sidecar } = seedSlot(id, {
      'facet.json': '{"name":"audit-canon","version":"1.0.0"}',
    })
    // Corrupt the sidecar's top-level integrity while leaving assets intact.
    const corruptSidecar: CacheIntegrity = {
      ...sidecar,
      integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }
    const result = auditCacheSlot(slotPath, corruptSidecar)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('tampered')
  })
})

// ---------------------------------------------------------------------------
// evictCacheSlot
// ---------------------------------------------------------------------------

describe('evictCacheSlot', () => {
  test('removes the slot directory', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'evict-me', version: '1.0.0' }
    const slotPath = cachePath(id)
    mkdirSync(slotPath, { recursive: true })
    writeFileSync(join(slotPath, 'facet.json'), '{}')
    expect(existsSync(slotPath)).toBe(true)
    evictCacheSlot(slotPath)
    expect(existsSync(slotPath)).toBe(false)
  })

  test('is idempotent on an already-missing path', () => {
    evictCacheSlot(join(cacheDir, 'nonexistent'))
    // No throw, no error.
  })

  test('subsequent cacheGet returns a miss', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'evict-miss', version: '1.0.0' }
    const slotPath = cachePath(id)
    mkdirSync(slotPath, { recursive: true })
    expect(cacheGet(id).hit).toBe(true)
    evictCacheSlot(slotPath)
    expect(cacheGet(id).hit).toBe(false)
  })
})
