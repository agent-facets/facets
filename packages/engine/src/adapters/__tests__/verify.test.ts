import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import { verifyAdapter } from '../verify.ts'

/**
 * Verifier tests operate on real bundle files: each fixture writes an
 * `.mjs` module into a fresh temp dir and lets `verifyAdapter` import it.
 * Every adapter fixture's contract methods THROW when invoked — proving
 * that verification classifies bundles without ever calling an adapter
 * contract method.
 */

const THROWING_METHODS = `
  buildAssetMetadata() { throw new Error('contract method invoked during verification') },
  async installAsset() { throw new Error('contract method invoked during verification') },
  async readAsset() { throw new Error('contract method invoked during verification') },
  async deleteAsset() { throw new Error('contract method invoked during verification') },
`

/** Write `source` as an .mjs bundle in a fresh temp dir; run `fn` on its path. */
async function withBundle(source: string, fn: (bundlePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'facet-verify-test-'))
  try {
    const bundlePath = join(dir, 'adapter.mjs')
    await Bun.write(bundlePath, source)
    await fn(bundlePath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function adapterSource(fields: string): string {
  return `export default {\n${fields}\n${THROWING_METHODS}\n}`
}

describe('verifyAdapter — ordered checks', () => {
  test('1: unimportable bundle fails with import-failed', async () => {
    await withBundle(`import missing from 'this-package-does-not-exist-xyz'\nexport default missing`, async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      expect(result.failure.kind).toBe('import-failed')
    })
  })

  test('2: module without a default export fails with no-default-export', async () => {
    await withBundle(`export const notAnAdapter = 1`, async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      expect(result.failure.kind).toBe('no-default-export')
    })
  })

  test('2: non-object default export fails with no-default-export', async () => {
    await withBundle(`export default 42`, async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      expect(result.failure.kind).toBe('no-default-export')
    })
  })

  test('3: missing runtime declaration fails as api-missing', async () => {
    await withBundle(adapterSource(`  name: 'undeclared',`), async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-missing',
        adapter: 'undeclared',
        supported: [ADAPTER_API_VERSION],
      })
    })
  })

  test('3: malformed runtime declaration fails as api-malformed', async () => {
    await withBundle(adapterSource(`  name: 'malformed', apiVersion: '0.0.1',`), async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-malformed',
        adapter: 'malformed',
        found: '0.0.1',
        supported: [ADAPTER_API_VERSION],
      })
    })
  })

  test('4: well-formed unsupported declaration fails as api-unsupported', async () => {
    await withBundle(adapterSource(`  name: 'future', apiVersion: '9.9',`), async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-unsupported',
        adapter: 'future',
        found: '9.9',
        supported: [ADAPTER_API_VERSION],
      })
    })
  })

  test('4: superseded positional 0.0 declaration fails as api-unsupported', async () => {
    // The exact cutover: a bundle built against the earlier positional
    // contract declares 0.0, which is well-formed but unsupported by a
    // 0.1-only CLI. It must fail closed before any contract method.
    await withBundle(adapterSource(`  name: 'legacy-positional', apiVersion: '0.0',`), async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-unsupported',
        adapter: 'legacy-positional',
        found: '0.0',
        supported: [ADAPTER_API_VERSION],
      })
    })
  })

  test('4 precedes 5: unsupported runtime declaration wins over metadata equality', async () => {
    // Even when npm metadata agrees with the runtime declaration, an
    // unsupported API is classified as unsupported, not as a mismatch.
    await withBundle(adapterSource(`  name: 'future', apiVersion: '9.9',`), async (path) => {
      const result = await verifyAdapter(path, { expectedApiVersion: '9.9' })
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure.kind).toBe('api-unsupported')
    })
  })

  test('5: package/runtime disagreement fails as api-metadata-mismatch', async () => {
    // Runtime declares the supported API (so the support check passes),
    // but the npm package metadata claims a different well-formed token —
    // the mismatch check (5) fires. Use a high token that is neither the
    // supported API nor the superseded 0.0, so this stays a mismatch
    // rather than collapsing into the unsupported-runtime path.
    await withBundle(adapterSource(`  name: 'split-brain', apiVersion: '${ADAPTER_API_VERSION}',`), async (path) => {
      const result = await verifyAdapter(path, { expectedApiVersion: '9.9' })
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-metadata-mismatch',
        adapter: 'split-brain',
        packageDeclared: '9.9',
        runtimeDeclared: ADAPTER_API_VERSION,
        supported: [ADAPTER_API_VERSION],
      })
    })
  })

  test('6: missing name fails with invalid-name', async () => {
    await withBundle(adapterSource(`  apiVersion: '${ADAPTER_API_VERSION}',`), async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      expect(result.failure.kind).toBe('invalid-name')
    })
  })

  test('6: missing contract method fails with invalid-shape', async () => {
    await withBundle(
      `export default { name: 'incomplete', apiVersion: '${ADAPTER_API_VERSION}', buildAssetMetadata() {}, async installAsset() {}, async readAsset() {} }`,
      async (path) => {
        const result = await verifyAdapter(path)
        if (result.ok) expect.unreachable()
        if (result.failure.kind !== 'invalid-shape') expect.unreachable()
        expect(result.failure.adapter).toBe('incomplete')
        expect(result.failure.detail).toContain('deleteAsset')
      },
    )
  })

  test('supported bundle verifies without invoking any contract method', async () => {
    await withBundle(adapterSource(`  name: 'good', apiVersion: '${ADAPTER_API_VERSION}',`), async (path) => {
      const result = await verifyAdapter(path)
      // Every contract method in the fixture throws on invocation, so a
      // success result proves none were called.
      if (!result.ok) expect.unreachable()
      expect(result.verified.adapter.name).toBe('good')
      expect(result.verified.apiVersion).toBe(ADAPTER_API_VERSION)
    })
  })

  test('supported bundle with matching npm metadata verifies', async () => {
    await withBundle(adapterSource(`  name: 'good', apiVersion: '${ADAPTER_API_VERSION}',`), async (path) => {
      const result = await verifyAdapter(path, { expectedApiVersion: ADAPTER_API_VERSION })
      if (!result.ok) expect.unreachable()
      expect(result.verified.apiVersion).toBe(ADAPTER_API_VERSION)
    })
  })

  test('incompatible bundle with throwing methods never invokes them', async () => {
    // The fixture's methods throw; classification must happen before any
    // method access could matter. Reaching a structured failure (rather
    // than an escaped throw) proves non-invocation on the failure path.
    await withBundle(adapterSource(`  name: 'future', apiVersion: '9.9',`), async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      expect(result.failure.kind).toBe('incompatible')
    })
  })
})
