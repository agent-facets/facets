/**
 * Packed-manifest coverage for first-party adapter packages.
 *
 * Proves two things about the prepack pipeline:
 *
 * 1. Every real first-party adapter manifest under `packages/adapters/`,
 *    when run through the full prepack transform chain, publishes the
 *    canonical adapter API metadata field.
 * 2. The `scripts/prepack.ts` entry script itself qualifies exactly the
 *    packages under `packages/adapters/` for injection — an unrelated
 *    package's manifest is left untouched. This runs the real script
 *    against a fabricated temp monorepo.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ADAPTER_API_VERSION, ADAPTER_API_VERSION_PACKAGE_FIELD } from '../packages/adapter/src/api-version'
import {
  applyPublishConfig,
  createDiskResolver,
  injectAdapterApiVersion,
  rewriteWorkspaceDeps,
  stripDevDependencies,
} from './lib/prepack'

const repoRoot = resolve(import.meta.dir, '..')
const adaptersDir = resolve(repoRoot, 'packages', 'adapters')
const prepackScript = resolve(repoRoot, 'scripts', 'prepack.ts')

/** Enumerate the real first-party adapter package manifests. */
async function adapterManifestPaths(): Promise<string[]> {
  const paths: string[] = []
  for await (const entry of new Bun.Glob('*/package.json').scan(adaptersDir)) {
    paths.push(resolve(adaptersDir, entry))
  }
  return paths.sort()
}

describe('first-party adapter packed manifests', () => {
  test('every adapter package publishes the canonical API field after the prepack chain', async () => {
    const manifests = await adapterManifestPaths()
    // Guard against silently testing nothing if the layout moves.
    expect(manifests.length).toBeGreaterThan(0)

    const resolver = createDiskResolver(repoRoot)
    for (const manifestPath of manifests) {
      const pkg = await Bun.file(manifestPath).json()

      const { pkg: afterDeps } = await rewriteWorkspaceDeps(pkg, resolver)
      const { pkg: afterPublish } = applyPublishConfig(afterDeps)
      const { pkg: afterStrip } = stripDevDependencies(afterPublish)
      const { pkg: packed } = injectAdapterApiVersion(afterStrip, {
        fieldName: ADAPTER_API_VERSION_PACKAGE_FIELD,
        version: ADAPTER_API_VERSION,
      })

      expect(packed[ADAPTER_API_VERSION_PACKAGE_FIELD]).toBe(ADAPTER_API_VERSION)
    }
  })
})

describe('prepack.ts adapter qualification', () => {
  /**
   * Run the real prepack script from `packageDir` (inside a fake monorepo
   * scaffolded by `withFakeMonorepo`) and return the resulting manifest.
   */
  async function runPrepackIn(
    packageDir: string,
  ): Promise<{ manifest: Record<string, unknown>; exitCode: number; stderr: string }> {
    const proc = Bun.spawn(['bun', prepackScript], {
      cwd: packageDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    const manifest = await Bun.file(join(packageDir, 'package.json')).json()
    return { manifest, exitCode, stderr }
  }

  async function withFakeMonorepo(fn: (rootDir: string) => Promise<void>): Promise<void> {
    const rootDir = await mkdtemp(join(tmpdir(), 'prepack-adapters-test-'))
    try {
      await Bun.write(
        join(rootDir, 'package.json'),
        JSON.stringify({ name: 'fake-root', private: true, workspaces: ['packages/*', 'packages/adapters/*'] }),
      )
      await Bun.write(
        join(rootDir, 'packages/adapters/fake/package.json'),
        JSON.stringify({ name: '@fake/adapter-fake', version: '1.0.0' }),
      )
      await Bun.write(
        join(rootDir, 'packages/library/package.json'),
        JSON.stringify({ name: '@fake/library', version: '1.0.0' }),
      )
      await fn(rootDir)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  }

  test('injects the canonical API field for a package under packages/adapters/', async () => {
    await withFakeMonorepo(async (rootDir) => {
      const packageDir = join(rootDir, 'packages/adapters/fake')
      const { manifest, exitCode, stderr } = await runPrepackIn(packageDir)

      expect(exitCode).toBe(0)
      expect(manifest[ADAPTER_API_VERSION_PACKAGE_FIELD]).toBe(ADAPTER_API_VERSION)
      expect(stderr).toContain(ADAPTER_API_VERSION_PACKAGE_FIELD)
      // A backup must exist so postpack can restore the source manifest.
      expect(await Bun.file(join(packageDir, '.package.json.bak')).exists()).toBe(true)
    })
  })

  test('leaves a package outside packages/adapters/ untouched', async () => {
    await withFakeMonorepo(async (rootDir) => {
      const packageDir = join(rootDir, 'packages/library')
      const { manifest, exitCode } = await runPrepackIn(packageDir)

      expect(exitCode).toBe(0)
      expect(ADAPTER_API_VERSION_PACKAGE_FIELD in manifest).toBe(false)
      // Nothing was modified, so no backup is written.
      expect(await Bun.file(join(packageDir, '.package.json.bak')).exists()).toBe(false)
    })
  })
})
