/**
 * Shared types and pure functions for the CLI cross-compilation build script.
 * Extracted for testability — the runner script (scripts/build-cli.ts) imports from here.
 */

import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Target {
  os: string
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

export function packageName(item: Target): string {
  const suffix = [
    item.os === 'win32' ? 'windows' : item.os,
    item.arch,
    item.avx2 === false ? 'baseline' : undefined,
    item.abi,
  ]
    .filter(Boolean)
    .join('-')
  return `@agent-facets/cli-${suffix}`
}

export function bunTarget(name: string): string {
  return name.replace('@agent-facets/cli', 'bun')
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

export function buildPackageJson(name: string, version: string, item: Target): TargetPackageJson {
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
