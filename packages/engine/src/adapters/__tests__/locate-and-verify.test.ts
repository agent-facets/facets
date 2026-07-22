import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import { locateAndVerifyAdapter } from '../install-service.ts'

/**
 * Fallback-eligibility tests for `locateAndVerifyAdapter`.
 *
 * Only an `import-failed` prebuilt bundle may fall back to
 * rebundling-from-source. A compatibility contradiction in a prebuilt
 * bundle is terminal — proven here by giving each fixture a source tree
 * that WOULD produce a valid adapter if the fallback ran.
 */

/** A dependency-free adapter module source that verifies successfully. */
function validAdapterModule(name: string): string {
  return `export default {
  name: '${name}',
  apiVersion: '${ADAPTER_API_VERSION}',
  buildAssetMetadata: () => ({ ok: true, data: {} }),
  installAsset: async () => undefined,
  readAsset: async () => ({ content: '' }),
  deleteAsset: async () => undefined,
}
`
}

async function makeFixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'facet-locate-verify-test-'))
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative)
    await mkdir(dirname(absolute), { recursive: true })
    await Bun.write(absolute, content)
  }
  return dir
}

describe('locateAndVerifyAdapter — fallback eligibility', () => {
  test('prebuilt bundle that fails to import falls back to rebundling from source', async () => {
    const dir = await makeFixture({
      'package.json': JSON.stringify({ name: 'fixture-adapter', exports: './dist/index.mjs' }),
      // Unresolvable external import → dynamic import() throws → fallback eligible.
      'dist/index.mjs': `import missing from 'this-package-does-not-exist-xyz'\nexport default missing`,
      'src/index.ts': validAdapterModule('fallback-adapter'),
    })
    try {
      const result = await locateAndVerifyAdapter(dir)
      if (!result.ok) expect.unreachable()
      expect(result.verified.adapter.name).toBe('fallback-adapter')
      expect(result.verified.apiVersion).toBe(ADAPTER_API_VERSION)
      await result.cleanup()
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)

  test('prebuilt bundle with an unsupported API is terminal — no rebundle', async () => {
    const dir = await makeFixture({
      'package.json': JSON.stringify({ name: 'fixture-adapter', exports: './dist/index.mjs' }),
      'dist/index.mjs': `export default {
  name: 'future-adapter',
  apiVersion: '9.9',
  buildAssetMetadata: () => ({ ok: true, data: {} }),
  installAsset: async () => undefined,
  readAsset: async () => ({ content: '' }),
  deleteAsset: async () => undefined,
}`,
      // Would verify successfully if the (forbidden) fallback ran.
      'src/index.ts': validAdapterModule('future-adapter'),
    })
    try {
      const result = await locateAndVerifyAdapter(dir)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-unsupported',
        adapter: 'future-adapter',
        found: '9.9',
        supported: [ADAPTER_API_VERSION],
      })
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('prebuilt bundle with a missing API declaration is terminal — no rebundle', async () => {
    const dir = await makeFixture({
      'package.json': JSON.stringify({ name: 'fixture-adapter', exports: './dist/index.mjs' }),
      'dist/index.mjs': `export default {
  name: 'legacy-adapter',
  buildAssetMetadata: () => ({ ok: true, data: {} }),
  installAsset: async () => undefined,
  readAsset: async () => ({ content: '' }),
  deleteAsset: async () => undefined,
}`,
      'src/index.ts': validAdapterModule('legacy-adapter'),
    })
    try {
      const result = await locateAndVerifyAdapter(dir)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure.kind).toBe('api-missing')
      // The failure identifies the original prebuilt path, not a
      // transient isolation copy.
      if (result.failure.failure.kind !== 'api-missing') expect.unreachable()
      expect(result.failure.bundlePath).toBe(join(dir, 'dist/index.mjs'))
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('valid prebuilt bundle verifies on the fast path', async () => {
    const dir = await makeFixture({
      'package.json': JSON.stringify({ name: 'fixture-adapter', exports: './dist/index.mjs' }),
      'dist/index.mjs': validAdapterModule('prebuilt-adapter'),
    })
    try {
      const result = await locateAndVerifyAdapter(dir)
      if (!result.ok) expect.unreachable()
      expect(result.verified.adapter.name).toBe('prebuilt-adapter')
      // Fast path returns the in-tree bundle path with a no-op cleanup.
      expect(result.bundlePath).toBe(join(dir, 'dist/index.mjs'))
      await result.cleanup()
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
