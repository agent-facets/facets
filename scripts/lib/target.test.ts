import { describe, expect, test } from 'bun:test'
import {
  allTargets,
  buildTargetPackageJson,
  bunTarget,
  filterTargets,
  outfilePath,
  type PackageName,
  packageJsonPath,
  packageName,
  shouldSmokeTest,
  type Target,
} from './target'

describe('packageName', () => {
  test.each([
    [{ os: 'linux', arch: 'arm64' }, '@agent-facets/cli-linux-arm64'],
    [{ os: 'linux', arch: 'x64' }, '@agent-facets/cli-linux-x64'],
    [{ os: 'linux', arch: 'x64', avx2: false }, '@agent-facets/cli-linux-x64-baseline'],
    [{ os: 'linux', arch: 'arm64', abi: 'musl' }, '@agent-facets/cli-linux-arm64-musl'],
    [{ os: 'linux', arch: 'x64', abi: 'musl' }, '@agent-facets/cli-linux-x64-musl'],
    [{ os: 'linux', arch: 'x64', avx2: false, abi: 'musl' }, '@agent-facets/cli-linux-x64-baseline-musl'],
    [{ os: 'darwin', arch: 'arm64' }, '@agent-facets/cli-darwin-arm64'],
    [{ os: 'darwin', arch: 'x64' }, '@agent-facets/cli-darwin-x64'],
    [{ os: 'darwin', arch: 'x64', avx2: false }, '@agent-facets/cli-darwin-x64-baseline'],
    [{ os: 'win32', arch: 'arm64' }, '@agent-facets/cli-windows-arm64'],
    [{ os: 'win32', arch: 'x64' }, '@agent-facets/cli-windows-x64'],
    [{ os: 'win32', arch: 'x64', avx2: false }, '@agent-facets/cli-windows-x64-baseline'],
  ] as const satisfies [Target, string][])('%j → %s', (target, expected) => {
    expect(packageName(target)).toBe(expected)
  })
})

describe('bunTarget', () => {
  test.each([
    ['@agent-facets/cli-darwin-arm64', 'bun-darwin-arm64'],
    ['@agent-facets/cli-linux-x64-baseline-musl', 'bun-linux-x64-baseline-musl'],
    ['@agent-facets/cli-windows-x64', 'bun-windows-x64'],
    ['@agent-facets/cli-linux-arm64-musl', 'bun-linux-arm64-musl'],
  ] as const satisfies [PackageName, string][])('%s → %s', (name, expected) => {
    expect(bunTarget(name)).toBe(expected)
  })
})

describe('allTargets', () => {
  test('has exactly 12 entries', () => {
    expect(allTargets).toHaveLength(12)
  })

  test('every target produces a valid package name starting with @agent-facets/cli-', () => {
    for (const target of allTargets) {
      expect(packageName(target)).toStartWith('@agent-facets/cli-')
    }
  })

  test('every package name produces a bun target starting with bun-', () => {
    for (const target of allTargets) {
      expect(bunTarget(packageName(target))).toStartWith('bun-')
    }
  })

  test('all package names are unique', () => {
    const names = allTargets.map(packageName)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('filterTargets', () => {
  test('single: false returns all 12', () => {
    const result = filterTargets(allTargets, { single: false, platform: 'darwin', arch: 'arm64' })
    expect(result).toHaveLength(12)
  })

  test('single darwin arm64 returns exactly 1', () => {
    const result = filterTargets(allTargets, { single: true, platform: 'darwin', arch: 'arm64' })
    expect(result).toHaveLength(1)
    expect(result.map(packageName)).toEqual(['@agent-facets/cli-darwin-arm64'])
  })

  test('single linux x64 returns exactly 1 (no baseline, no musl)', () => {
    const result = filterTargets(allTargets, { single: true, platform: 'linux', arch: 'x64' })
    expect(result).toHaveLength(1)
    expect(result.map(packageName)).toEqual(['@agent-facets/cli-linux-x64'])
  })

  test('single+baseline linux x64 returns exactly 1 (baseline only)', () => {
    const result = filterTargets(allTargets, { single: true, baseline: true, platform: 'linux', arch: 'x64' })
    expect(result).toHaveLength(1)
    expect(result.map(packageName)).toEqual(['@agent-facets/cli-linux-x64-baseline'])
  })

  test('single linux arm64 returns exactly 1 (skips musl)', () => {
    const result = filterTargets(allTargets, { single: true, platform: 'linux', arch: 'arm64' })
    expect(result).toHaveLength(1)
    expect(result.map(packageName)).toEqual(['@agent-facets/cli-linux-arm64'])
  })

  test('single win32 x64 returns exactly 1', () => {
    const result = filterTargets(allTargets, { single: true, platform: 'win32', arch: 'x64' })
    expect(result).toHaveLength(1)
    expect(result.map(packageName)).toEqual(['@agent-facets/cli-windows-x64'])
  })

  test('single with unknown platform returns empty', () => {
    const result = filterTargets(allTargets, { single: true, platform: 'freebsd', arch: 'x64' })
    expect(result).toHaveLength(0)
  })

  test('target: "darwin-arm64" returns exactly 1', () => {
    const result = filterTargets(allTargets, { single: false, target: 'darwin-arm64', platform: 'linux', arch: 'x64' })
    expect(result).toHaveLength(1)
    expect(result.map(packageName)).toEqual(['@agent-facets/cli-darwin-arm64'])
  })

  test('target: "linux-x64-baseline-musl" returns exactly 1', () => {
    const result = filterTargets(allTargets, {
      single: false,
      target: 'linux-x64-baseline-musl',
      platform: 'linux',
      arch: 'x64',
    })
    expect(result).toHaveLength(1)
    expect(result.map(packageName)).toEqual(['@agent-facets/cli-linux-x64-baseline-musl'])
  })

  test('target: "nonexistent" returns empty', () => {
    const result = filterTargets(allTargets, { single: false, target: 'nonexistent', platform: 'linux', arch: 'x64' })
    expect(result).toHaveLength(0)
  })

  test('target takes precedence over single', () => {
    const result = filterTargets(allTargets, { single: true, target: 'darwin-arm64', platform: 'linux', arch: 'x64' })
    expect(result).toHaveLength(1)
    expect(result.map(packageName)).toEqual(['@agent-facets/cli-darwin-arm64'])
  })
})

describe('buildPackageJson', () => {
  test('produces correct os and cpu fields for linux x64', () => {
    const target: Target = { os: 'linux', arch: 'x64' }
    const result = buildTargetPackageJson('@agent-facets/cli-linux-x64', '1.0.0', target)
    expect(result).toEqual({
      name: '@agent-facets/cli-linux-x64',
      version: '1.0.0',
      os: ['linux'],
      cpu: ['x64'],
    })
  })

  test('uses raw os value (win32) not the display name (windows)', () => {
    const target: Target = { os: 'win32', arch: 'x64' }
    const result = buildTargetPackageJson('@agent-facets/cli-windows-x64', '2.0.0', target)
    expect(result.os).toEqual(['win32'])
    expect(result.cpu).toEqual(['x64'])
  })

  test('uses the provided version', () => {
    const target: Target = { os: 'darwin', arch: 'arm64' }
    const result = buildTargetPackageJson('@agent-facets/cli-darwin-arm64', '3.5.7', target)
    expect(result.version).toBe('3.5.7')
  })
})

describe('shouldSmokeTest', () => {
  test('returns true when target matches current platform and arch', () => {
    expect(shouldSmokeTest({ os: 'darwin', arch: 'arm64' }, 'darwin', 'arm64')).toBe(true)
  })

  test('returns false when os differs', () => {
    expect(shouldSmokeTest({ os: 'linux', arch: 'arm64' }, 'darwin', 'arm64')).toBe(false)
  })

  test('returns false when arch differs', () => {
    expect(shouldSmokeTest({ os: 'darwin', arch: 'x64' }, 'darwin', 'arm64')).toBe(false)
  })

  test('returns false for musl target even when os/arch match', () => {
    expect(shouldSmokeTest({ os: 'linux', arch: 'x64', abi: 'musl' }, 'linux', 'x64')).toBe(false)
  })

  test('returns true for baseline target when os/arch match', () => {
    expect(shouldSmokeTest({ os: 'linux', arch: 'x64', avx2: false }, 'linux', 'x64')).toBe(true)
  })
})

describe('outfilePath', () => {
  test('produces correct path structure', () => {
    const result = outfilePath('/opt/cli', '@agent-facets/cli-darwin-arm64')
    expect(result).toBe('/opt/cli/dist/@agent-facets/cli-darwin-arm64/bin/facet')
  })
})

describe('packageJsonPath', () => {
  test('produces correct path structure', () => {
    const result = packageJsonPath('/opt/cli', '@agent-facets/cli-darwin-arm64')
    expect(result).toBe('/opt/cli/dist/@agent-facets/cli-darwin-arm64/package.json')
  })
})
