import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type CacheIdentity,
  cacheGet,
  cachePath,
  cachePut,
  cacheSlot,
  cacheSlotIsDir,
  cacheStagingDir,
  resolveCacheRoot,
} from '../cache/index.ts'

let cacheDir: string
let originalEnv: string | undefined

beforeEach(() => {
  originalEnv = process.env.FACETS_CACHE_DIR
  cacheDir = mkdtempSync(join(tmpdir(), 'facet-cache-test-'))
  process.env.FACETS_CACHE_DIR = cacheDir
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.FACETS_CACHE_DIR
  } else {
    process.env.FACETS_CACHE_DIR = originalEnv
  }
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('resolveCacheRoot', () => {
  test('uses FACETS_CACHE_DIR when set', () => {
    expect(resolveCacheRoot()).toBe(cacheDir)
  })

  test('treats whitespace-only env as unset', () => {
    process.env.FACETS_CACHE_DIR = '   '
    const result = resolveCacheRoot()
    expect(result).not.toBe('   ')
    expect(result.endsWith(join('.facets', 'cache'))).toBe(true)
  })

  test('treats empty env as unset', () => {
    process.env.FACETS_CACHE_DIR = ''
    const result = resolveCacheRoot()
    expect(result.endsWith(join('.facets', 'cache'))).toBe(true)
  })
})

describe('cacheSlot', () => {
  test('registry slot uses name@version', () => {
    expect(cacheSlot({ kind: 'registry', name: 'viper-plans', version: '1.2.3' })).toBe('viper-plans@1.2.3')
  })

  test('git slot uses name@commit', () => {
    expect(cacheSlot({ kind: 'git', name: 'viper-plans', commit: 'abc123def456' })).toBe('viper-plans@abc123def456')
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
})

describe('cachePut', () => {
  test('moves a populated staging dir into the cache slot', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const staging = cacheStagingDir()
    writeFileSync(join(staging, 'facet.json'), '{"name":"p","version":"1.0.0"}')
    writeFileSync(join(staging, 'README.md'), '# p')
    const finalPath = cachePut(id, staging)
    expect(finalPath).toBe(cachePath(id))
    expect(existsSync(staging)).toBe(false)
    expect(cacheSlotIsDir(id)).toBe(true)
    expect(existsSync(join(finalPath, 'facet.json'))).toBe(true)
    expect(existsSync(join(finalPath, 'README.md'))).toBe(true)
  })

  test('concurrent put: existing slot wins, loser is cleaned up', () => {
    const id: CacheIdentity = { kind: 'registry', name: 'p', version: '1.0.0' }
    const winner = cacheStagingDir()
    writeFileSync(join(winner, 'marker.txt'), 'winner')
    cachePut(id, winner)

    const loser = cacheStagingDir()
    writeFileSync(join(loser, 'marker.txt'), 'loser')
    const result = cachePut(id, loser)

    expect(result).toBe(cachePath(id))
    expect(existsSync(loser)).toBe(false)
    expect(Bun.file(join(cachePath(id), 'marker.txt')).text()).resolves.toBe('winner')
  })

  test('puts for distinct identities do not collide', () => {
    const a: CacheIdentity = { kind: 'registry', name: 'a', version: '1.0.0' }
    const b: CacheIdentity = { kind: 'registry', name: 'b', version: '1.0.0' }
    const stagingA = cacheStagingDir()
    writeFileSync(join(stagingA, 'name.txt'), 'a')
    const stagingB = cacheStagingDir()
    writeFileSync(join(stagingB, 'name.txt'), 'b')
    cachePut(a, stagingA)
    cachePut(b, stagingB)
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
    cachePut(a, stagingA)
    cachePut(b, stagingB)
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
})
