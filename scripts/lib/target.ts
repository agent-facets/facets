/**
 * Platform target definitions and package helpers for CLI cross-compilation.
 * Extracted for testability — the runner script (scripts/build-facet-cli.ts) imports from here.
 */

import { resolve } from 'node:path'
import { MAIN_PACKAGE_NAME } from './constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Target {
  os: 'darwin' | 'linux' | 'win32'
  arch: 'arm64' | 'x64'
  abi?: 'musl'
  avx2?: false
}

export interface FilterOptions {
  single: boolean
  baseline?: boolean
  target?: string
  platform: string
  arch: string
}

export interface TargetPackageJson {
  name: string
  version: string
  os: string[]
  cpu: string[]
}

/** All 13 npm package names: 12 platform binaries + the main package. */
export function allPackageNames(): string[] {
  return [...allTargets.map(packageName), MAIN_PACKAGE_NAME]
}

// ---------------------------------------------------------------------------
// Target matrix
// ---------------------------------------------------------------------------

export const allTargets: Target[] = [
  { os: 'linux', arch: 'arm64' },
  { os: 'linux', arch: 'x64' },
  { os: 'linux', arch: 'x64', avx2: false },
  { os: 'linux', arch: 'arm64', abi: 'musl' },
  { os: 'linux', arch: 'x64', abi: 'musl' },
  { os: 'linux', arch: 'x64', avx2: false, abi: 'musl' },
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'x64' },
  { os: 'darwin', arch: 'x64', avx2: false },
  { os: 'win32', arch: 'arm64' },
  { os: 'win32', arch: 'x64' },
  { os: 'win32', arch: 'x64', avx2: false },
]

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export type PackageName = ReturnType<typeof packageName>

export function packageName(item: Target) {
  const os = item.os === 'win32' ? 'windows' : (`${item.os}` as const)
  const arch = `-${item.arch}` as const
  const avx2 = item.avx2 === false ? '-baseline' : ''
  const abi = item.abi ? (`-${item.abi}` as const) : ('' as const)

  const os_arch = `${os}${arch}` as const
  const suffix = `${os_arch}${avx2}${abi}` as const

  return `@agent-facets/cli-${suffix}` as const
}

export function bunTarget(name: PackageName): Bun.Build.CompileTarget {
  return name.replace('@agent-facets/cli', 'bun') as Bun.Build.CompileTarget
}

export function filterTargets(targets: Target[], opts: FilterOptions): Target[] {
  if (opts.target) {
    const fullName = `@agent-facets/cli-${opts.target}`
    return targets.filter((item) => packageName(item) === fullName)
  }

  if (!opts.single) return targets

  return targets.filter((item) => {
    if (item.os !== opts.platform || item.arch !== opts.arch) return false
    // Skip ABI-specific builds (e.g. musl) in single mode
    if (item.abi !== undefined) return false
    // When --baseline: only include baseline.
    if (opts.baseline) return item.avx2 === false
    // Otherwise: only include non-baseline.
    return item.avx2 !== false
  })
}

export function buildTargetPackageJson(name: string, version: string, item: Target): TargetPackageJson {
  return {
    name,
    version,
    os: [item.os],
    cpu: [item.arch],
  }
}

export function shouldSmokeTest(item: Target, platform: string, arch: string): boolean {
  return item.os === platform && item.arch === arch && !item.abi
}

export function outfilePath(cliDir: string, name: string): string {
  return resolve(cliDir, 'dist', name, 'bin', 'facet')
}

export function packageJsonPath(cliDir: string, name: string): string {
  return resolve(cliDir, 'dist', name, 'package.json')
}
