/**
 * Tests for the agentfacets.io/install Lambda and the installer script.
 *
 * Covers:
 *  - Handler returns 200 with correct content-type, cache-control, and body shape.
 *  - install.sh passes shellcheck (if shellcheck is available).
 *  - install.sh Windows branch prints an error and exits non-zero.
 *  - install.sh build_target() picks the right target for each scenario.
 *  - install.sh end-to-end: downloads + verifies + installs from a local
 *    file:// registry serving a fixture tarball.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// This file sits at packages/functions/src/__tests__/install.test.ts
// The installer script lives at packages/landing/scripts/install.sh
// The Lambda handler expects LAMBDA_TASK_ROOT to contain scripts/install.sh,
// so we point it at packages/landing/ for the duration of the test run.
const LANDING_ROOT = resolve(__dirname, '..', '..', '..', 'landing')
const SCRIPT_PATH = join(LANDING_ROOT, 'scripts', 'install.sh')
const FIXTURE_DIR = join(__dirname, 'fixtures', 'install')

beforeAll(() => {
  // The Lambda handler reads scripts/install.sh at module load, keyed off
  // LAMBDA_TASK_ROOT — set that before the dynamic import in the handler
  // test runs.
  process.env.LAMBDA_TASK_ROOT = LANDING_ROOT
})

async function importHandler() {
  const mod = await import('../install')
  return mod.handler
}

// ---------------------------------------------------------------------------
// Handler response
// ---------------------------------------------------------------------------

describe('install Lambda handler', () => {
  test('returns 200 with the install script body', async () => {
    const handler = await importHandler()
    // biome-ignore lint/suspicious/noExplicitAny: Lambda event shape not used
    const res = (await handler({} as any, {} as any, () => {})) as {
      statusCode: number
      headers: Record<string, string>
      body: string
    }

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/x-shellscript; charset=utf-8')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
    expect(res.body.startsWith('#!/usr/bin/env bash\n')).toBe(true)
    expect(res.body.length).toBeGreaterThan(1000)
  })
})

// ---------------------------------------------------------------------------
// shellcheck
// ---------------------------------------------------------------------------

describe('install.sh shellcheck', () => {
  test('passes shellcheck (skipped if not installed)', () => {
    const which = spawnSync('which', ['shellcheck'])
    if (which.status !== 0) {
      console.warn('  [skip] shellcheck not installed — install with: brew install shellcheck')
      return
    }

    const result = spawnSync('shellcheck', [SCRIPT_PATH], { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(`shellcheck failed:\n${result.stdout}\n${result.stderr}`)
    }
  })
})

// ---------------------------------------------------------------------------
// Windows branch
// ---------------------------------------------------------------------------

describe('install.sh Windows branch', () => {
  test('exits non-zero with an error when uname -s reports MINGW64', () => {
    const shimDir = mkdtempSync(join(tmpdir(), 'facet-install-test-'))
    try {
      const shimPath = join(shimDir, 'uname')
      writeFileSync(
        shimPath,
        '#!/usr/bin/env bash\nif [[ "$1" == "-s" ]]; then echo "MINGW64_NT-10.0-19045"; else /usr/bin/uname "$@"; fi\n',
      )
      chmodSync(shimPath, 0o755)

      const result = spawnSync('bash', [SCRIPT_PATH, '--no-modify-path'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${shimDir}:${process.env.PATH ?? ''}`,
          FACET_DIR: join(shimDir, 'should-not-be-used'),
        },
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Windows is not supported')
      expect(result.stderr).toContain('npm install -g agent-facets')
    } finally {
      rmSync(shimDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// build_target parity (pure function)
// ---------------------------------------------------------------------------
//
// These tests call install.sh's build_target() directly. The function body
// is awk-extracted from the real script — if someone edits build_target in
// install.sh, these tests see the change.

interface Scenario {
  name: string
  os: 'darwin' | 'linux'
  arch: 'x64' | 'arm64'
  opts: { avx2?: boolean; musl?: boolean }
  expectedTarget: string
}

const SCENARIOS: Scenario[] = [
  { name: 'darwin-arm64', os: 'darwin', arch: 'arm64', opts: { avx2: false }, expectedTarget: 'darwin-arm64' },
  { name: 'darwin-x64 with AVX2', os: 'darwin', arch: 'x64', opts: { avx2: true }, expectedTarget: 'darwin-x64' },
  {
    name: 'darwin-x64 without AVX2',
    os: 'darwin',
    arch: 'x64',
    opts: { avx2: false },
    expectedTarget: 'darwin-x64-baseline',
  },
  {
    name: 'linux-arm64 glibc',
    os: 'linux',
    arch: 'arm64',
    opts: { avx2: false, musl: false },
    expectedTarget: 'linux-arm64',
  },
  {
    name: 'linux-arm64 musl',
    os: 'linux',
    arch: 'arm64',
    opts: { avx2: false, musl: true },
    expectedTarget: 'linux-arm64-musl',
  },
  {
    name: 'linux-x64 AVX2 glibc',
    os: 'linux',
    arch: 'x64',
    opts: { avx2: true, musl: false },
    expectedTarget: 'linux-x64',
  },
  {
    name: 'linux-x64 baseline glibc',
    os: 'linux',
    arch: 'x64',
    opts: { avx2: false, musl: false },
    expectedTarget: 'linux-x64-baseline',
  },
  {
    name: 'linux-x64 AVX2 musl',
    os: 'linux',
    arch: 'x64',
    opts: { avx2: true, musl: true },
    expectedTarget: 'linux-x64-musl',
  },
  {
    name: 'linux-x64 baseline musl',
    os: 'linux',
    arch: 'x64',
    opts: { avx2: false, musl: true },
    expectedTarget: 'linux-x64-baseline-musl',
  },
]

// Extract the build_target() function from install.sh via awk and call it
// with explicit parameters. Keeps install.sh as the single source of truth.
function runBuildTarget(s: { os: Scenario['os']; arch: Scenario['arch']; opts: Scenario['opts'] }): string {
  const needsBaseline = s.arch === 'x64' && s.opts.avx2 === false ? 'true' : 'false'
  const musl = s.os === 'linux' && s.opts.musl === true ? 'true' : 'false'

  const extract = `
    awk '
      /^build_target\\(\\) \\{/ { printing=1 }
      printing { print }
      printing && /^\\}/ { exit }
    ' "${SCRIPT_PATH}"
  `

  const cmd = `
    set -euo pipefail
    eval "$(${extract})"
    build_target "${s.os}" "${s.arch}" "${needsBaseline}" "${musl}"
  `

  const result = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`build_target harness failed:\n${result.stderr}\n${result.stdout}`)
  }
  return result.stdout.trim()
}

describe('install.sh build_target', () => {
  for (const s of SCENARIOS) {
    test(`picks ${s.expectedTarget} for ${s.name}`, () => {
      expect(runBuildTarget(s)).toBe(s.expectedTarget)
    })
  }
})

// ---------------------------------------------------------------------------
// End-to-end: real install flow against a file:// registry
// ---------------------------------------------------------------------------
//
// No server. install.sh's curl calls support file:// URLs just fine, so we
// lay out the expected registry tree on disk and point FACET_CLI_REGISTRY
// at it. Zero network, zero async, zero ports.
//
// Platform-agnostic: we detect the host's target via install.sh's own
// build_target (with host-derived inputs) and write the tarball/metadata
// under that target's path. Skipped on Windows.

describe('install.sh end-to-end against local registry', () => {
  let registryDir = ''
  let registryUrl = ''
  const fakeVersion = '99.0.0'

  beforeAll(() => {
    if (process.platform === 'win32') return

    // Resolve the target install.sh will pick on this host. Assume modern
    // glibc x64/arm64. On Alpine (musl) this would need a `-musl` variant
    // — the test would fail loudly there, which is fine.
    const hostOs = process.platform === 'darwin' ? 'darwin' : 'linux'
    const hostArch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const target = runBuildTarget({
      os: hostOs,
      arch: hostArch,
      opts: { avx2: true, musl: false },
    })

    registryDir = mkdtempSync(join(tmpdir(), 'facet-e2e-registry-'))
    registryUrl = `file://${registryDir}`

    // Stage the tarball contents.
    const stageDir = join(registryDir, 'pkg-stage')
    const pkgDir = join(stageDir, 'package')
    mkdirSync(pkgDir, { recursive: true })
    cpSync(join(FIXTURE_DIR, 'package'), pkgDir, { recursive: true })
    chmodSync(join(pkgDir, 'bin', 'facet'), 0o755)
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify(
        {
          name: `@agent-facets/cli-${target}`,
          version: fakeVersion,
          os: [hostOs],
          cpu: [hostArch],
        },
        null,
        2,
      ),
    )

    // Lay out the npm-style registry tree:
    //   <registryDir>/@agent-facets/cli-<target>/latest
    //   <registryDir>/@agent-facets/cli-<target>/-/cli-<target>-<version>.tgz
    const pkgRegistryDir = join(registryDir, '@agent-facets', `cli-${target}`)
    const tarballRegistryDir = join(pkgRegistryDir, '-')
    mkdirSync(tarballRegistryDir, { recursive: true })

    const tarballPath = join(tarballRegistryDir, `cli-${target}-${fakeVersion}.tgz`)
    const tarResult = spawnSync('tar', ['-czf', tarballPath, '-C', stageDir, 'package'], {
      encoding: 'utf8',
    })
    if (tarResult.status !== 0) {
      throw new Error(`failed to build fixture tarball: ${tarResult.stderr}`)
    }

    // Tear down the staging dir — the tarball is what matters now.
    rmSync(stageDir, { recursive: true, force: true })

    const shasum = createHash('sha1').update(readFileSync(tarballPath)).digest('hex')

    writeFileSync(
      join(pkgRegistryDir, 'latest'),
      JSON.stringify({
        name: `@agent-facets/cli-${target}`,
        version: fakeVersion,
        dist: {
          tarball: `${registryUrl}/@agent-facets/cli-${target}/-/cli-${target}-${fakeVersion}.tgz`,
          shasum,
        },
      }),
    )
  })

  afterAll(() => {
    if (registryDir) rmSync(registryDir, { recursive: true, force: true })
  })

  test.skipIf(process.platform === 'win32')(
    'downloads, verifies shasum, extracts, and installs a working binary',
    () => {
      const installDir = mkdtempSync(join(tmpdir(), 'facet-e2e-install-'))
      try {
        const result = spawnSync('bash', [SCRIPT_PATH, '--no-modify-path'], {
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            FACET_CLI_REGISTRY: registryUrl,
            FACET_DIR: installDir,
          },
        })

        if (result.status !== 0) {
          throw new Error(`install.sh exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
        }

        const installed = join(installDir, 'bin', 'facet')
        expect(existsSync(installed)).toBe(true)

        const run = spawnSync(installed, [], { encoding: 'utf8' })
        expect(run.status).toBe(0)
        expect(run.stdout.trim()).toBe('fake-facet 99.0.0')
      } finally {
        rmSync(installDir, { recursive: true, force: true })
      }
    },
  )
})
