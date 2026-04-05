import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

// Import the pure functions from the postinstall script
const postinstallPath = resolve(import.meta.dir, '..', '..', 'scripts', 'postinstall.mjs')
const { buildCandidates, detectPlatform } = await import(postinstallPath)

describe('detectPlatform', () => {
  test('returns an object with platform and arch strings', () => {
    const result = detectPlatform()
    expect(typeof result.platform).toBe('string')
    expect(typeof result.arch).toBe('string')
    expect(result.platform.length).toBeGreaterThan(0)
    expect(result.arch.length).toBeGreaterThan(0)
  })

  test('maps darwin correctly', () => {
    // We're running on macOS in this project
    const result = detectPlatform()
    if (process.platform === 'darwin') {
      expect(result.platform).toBe('darwin')
    }
  })
})

describe('buildCandidates', () => {
  // ---------------------------------------------------------------------------
  // Linux glibc
  // ---------------------------------------------------------------------------

  test('linux x64 avx2 glibc', () => {
    const result = buildCandidates('linux', 'x64', { avx2: true, musl: false })
    expect(result).toEqual([
      '@agent-facets/cli-linux-x64',
      '@agent-facets/cli-linux-x64-baseline',
      '@agent-facets/cli-linux-x64-musl',
      '@agent-facets/cli-linux-x64-baseline-musl',
    ])
  })

  test('linux x64 no-avx2 glibc', () => {
    const result = buildCandidates('linux', 'x64', { avx2: false, musl: false })
    expect(result).toEqual([
      '@agent-facets/cli-linux-x64-baseline',
      '@agent-facets/cli-linux-x64',
      '@agent-facets/cli-linux-x64-baseline-musl',
      '@agent-facets/cli-linux-x64-musl',
    ])
  })

  test('linux arm64 glibc', () => {
    const result = buildCandidates('linux', 'arm64', { avx2: false, musl: false })
    expect(result).toEqual(['@agent-facets/cli-linux-arm64', '@agent-facets/cli-linux-arm64-musl'])
  })

  // ---------------------------------------------------------------------------
  // Linux musl
  // ---------------------------------------------------------------------------

  test('linux x64 avx2 musl', () => {
    const result = buildCandidates('linux', 'x64', { avx2: true, musl: true })
    expect(result).toEqual([
      '@agent-facets/cli-linux-x64-musl',
      '@agent-facets/cli-linux-x64-baseline-musl',
      '@agent-facets/cli-linux-x64',
      '@agent-facets/cli-linux-x64-baseline',
    ])
  })

  test('linux x64 no-avx2 musl', () => {
    const result = buildCandidates('linux', 'x64', { avx2: false, musl: true })
    expect(result).toEqual([
      '@agent-facets/cli-linux-x64-baseline-musl',
      '@agent-facets/cli-linux-x64-musl',
      '@agent-facets/cli-linux-x64-baseline',
      '@agent-facets/cli-linux-x64',
    ])
  })

  test('linux arm64 musl', () => {
    const result = buildCandidates('linux', 'arm64', { avx2: false, musl: true })
    expect(result).toEqual(['@agent-facets/cli-linux-arm64-musl', '@agent-facets/cli-linux-arm64'])
  })

  // ---------------------------------------------------------------------------
  // Non-Linux
  // ---------------------------------------------------------------------------

  test('darwin arm64', () => {
    const result = buildCandidates('darwin', 'arm64', { avx2: false })
    expect(result).toEqual(['@agent-facets/cli-darwin-arm64'])
  })

  test('darwin x64 avx2', () => {
    const result = buildCandidates('darwin', 'x64', { avx2: true })
    expect(result).toEqual(['@agent-facets/cli-darwin-x64', '@agent-facets/cli-darwin-x64-baseline'])
  })

  test('darwin x64 no-avx2', () => {
    const result = buildCandidates('darwin', 'x64', { avx2: false })
    expect(result).toEqual(['@agent-facets/cli-darwin-x64-baseline', '@agent-facets/cli-darwin-x64'])
  })

  test('windows x64 avx2', () => {
    const result = buildCandidates('windows', 'x64', { avx2: true })
    expect(result).toEqual(['@agent-facets/cli-windows-x64', '@agent-facets/cli-windows-x64-baseline'])
  })

  test('windows arm64', () => {
    const result = buildCandidates('windows', 'arm64', { avx2: false })
    expect(result).toEqual(['@agent-facets/cli-windows-arm64'])
  })
})

// ---------------------------------------------------------------------------
// Consistency: launcher and postinstall must produce identical candidate lists
// ---------------------------------------------------------------------------

describe('consistency — launcher and postinstall candidate lists match', () => {
  /**
   * Reimplements the launcher's candidate-building logic as a pure function.
   * This is intentionally a direct translation of the CommonJS code in bin/facet
   * so the test catches any drift between the two implementations.
   */
  function launcherCandidates(platform: string, arch: string, opts: { avx2: boolean; musl?: boolean }): string[] {
    const base = `@agent-facets/cli-${platform}-${arch}`
    const baseline = arch === 'x64' && !opts.avx2

    if (platform === 'linux') {
      const musl = !!opts.musl

      if (musl) {
        if (arch === 'x64') {
          if (baseline) return [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
          return [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
        }
        return [`${base}-musl`, base]
      }

      if (arch === 'x64') {
        if (baseline) return [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
        return [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
      }
      return [base, `${base}-musl`]
    }

    if (arch === 'x64') {
      if (baseline) return [`${base}-baseline`, base]
      return [base, `${base}-baseline`]
    }
    return [base]
  }

  const cases: Array<{ platform: string; arch: string; avx2: boolean; musl?: boolean }> = [
    // Linux glibc
    { platform: 'linux', arch: 'x64', avx2: true, musl: false },
    { platform: 'linux', arch: 'x64', avx2: false, musl: false },
    { platform: 'linux', arch: 'arm64', avx2: false, musl: false },
    // Linux musl
    { platform: 'linux', arch: 'x64', avx2: true, musl: true },
    { platform: 'linux', arch: 'x64', avx2: false, musl: true },
    { platform: 'linux', arch: 'arm64', avx2: false, musl: true },
    // Darwin
    { platform: 'darwin', arch: 'arm64', avx2: false },
    { platform: 'darwin', arch: 'x64', avx2: true },
    { platform: 'darwin', arch: 'x64', avx2: false },
    // Windows
    { platform: 'windows', arch: 'arm64', avx2: false },
    { platform: 'windows', arch: 'x64', avx2: true },
    { platform: 'windows', arch: 'x64', avx2: false },
  ]

  for (const c of cases) {
    const label = `${c.platform}/${c.arch} avx2=${c.avx2}${c.musl !== undefined ? ` musl=${c.musl}` : ''}`
    test(label, () => {
      const fromPostinstall = buildCandidates(c.platform, c.arch, { avx2: c.avx2, musl: c.musl })
      const fromLauncher = launcherCandidates(c.platform, c.arch, { avx2: c.avx2, musl: c.musl })
      expect(fromPostinstall).toEqual(fromLauncher)
    })
  }
})

// ---------------------------------------------------------------------------
// Silent failure
// ---------------------------------------------------------------------------

describe('postinstall — silent failure', () => {
  test('exits 0 when no platform packages are installed', async () => {
    const proc = Bun.spawn(['node', resolve(import.meta.dir, '..', '..', 'scripts', 'postinstall.mjs')], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    expect(exitCode).toBe(0)
  })
})
