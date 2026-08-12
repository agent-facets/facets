import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION, ADAPTER_API_VERSION_ASSETS_ONLY } from '@agent-facets/adapter'
import { SUPPORTED_ADAPTER_APIS } from '../api-compatibility.ts'
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
  mcpServers: {
    async prepare() { throw new Error('contract method invoked during verification') },
    async apply() { throw new Error('contract method invoked during verification') },
  },
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

/**
 * A bundle shaped like the superseded asset-only contract: the four asset
 * methods and no `mcpServers` member at all. Not "declines MCP support" —
 * predates the question.
 */
function assetOnlyAdapterSource(fields: string): string {
  const assetMethods = THROWING_METHODS.slice(0, THROWING_METHODS.indexOf('  mcpServers:'))
  return `export default {\n${fields}\n${assetMethods}\n}`
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
        supported: SUPPORTED_ADAPTER_APIS,
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
        supported: SUPPORTED_ADAPTER_APIS,
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
        supported: SUPPORTED_ADAPTER_APIS,
      })
    })
  })

  test('4: superseded positional 0.0 declaration fails as api-unsupported', async () => {
    // The exact cutover: a bundle built against the earlier positional
    // contract declares 0.0, which is well-formed but outside the window
    // even though it is numerically adjacent to a member of it. It must
    // fail closed before any contract method.
    await withBundle(adapterSource(`  name: 'legacy-positional', apiVersion: '0.0',`), async (path) => {
      const result = await verifyAdapter(path)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-unsupported',
        adapter: 'legacy-positional',
        found: '0.0',
        supported: SUPPORTED_ADAPTER_APIS,
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
    // Runtime declares a supported API (so the support check passes), but
    // the npm package metadata claims a different well-formed token — the
    // mismatch check (5) fires.
    await withBundle(adapterSource(`  name: 'split-brain', apiVersion: '${ADAPTER_API_VERSION}',`), async (path) => {
      const result = await verifyAdapter(path, { expectedApiVersion: '9.9' })
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-metadata-mismatch',
        adapter: 'split-brain',
        packageDeclared: '9.9',
        runtimeDeclared: ADAPTER_API_VERSION,
        supported: SUPPORTED_ADAPTER_APIS,
      })
    })
  })

  test('5: two supported tokens still have to agree', async () => {
    // The case the window makes reachable for the first time: both tokens
    // are members of the support set, so neither fails the support check —
    // but one release cannot be two contracts, and picking either would
    // mean verifying a shape the other half of the release never promised.
    await withBundle(adapterSource(`  name: 'split-brain', apiVersion: '${ADAPTER_API_VERSION}',`), async (path) => {
      const result = await verifyAdapter(path, { expectedApiVersion: ADAPTER_API_VERSION_ASSETS_ONLY })
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'incompatible') expect.unreachable()
      expect(result.failure.failure).toEqual({
        kind: 'api-metadata-mismatch',
        adapter: 'split-brain',
        packageDeclared: ADAPTER_API_VERSION_ASSETS_ONLY,
        runtimeDeclared: ADAPTER_API_VERSION,
        supported: SUPPORTED_ADAPTER_APIS,
      })
    })
  })

  test('5: the reverse disagreement fails the same way', async () => {
    await withBundle(
      assetOnlyAdapterSource(`  name: 'split-brain', apiVersion: '${ADAPTER_API_VERSION_ASSETS_ONLY}',`),
      async (path) => {
        const result = await verifyAdapter(path, { expectedApiVersion: ADAPTER_API_VERSION })
        if (result.ok) expect.unreachable()
        if (result.failure.kind !== 'incompatible') expect.unreachable()
        expect(result.failure.failure.kind).toBe('api-metadata-mismatch')
      },
    )
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
      expect(result.verified.adapter.apiVersion).toBe(ADAPTER_API_VERSION)
    })
  })

  test('supported bundle with matching npm metadata verifies', async () => {
    await withBundle(adapterSource(`  name: 'good', apiVersion: '${ADAPTER_API_VERSION}',`), async (path) => {
      const result = await verifyAdapter(path, { expectedApiVersion: ADAPTER_API_VERSION })
      if (!result.ok) expect.unreachable()
      expect(result.verified.adapter.apiVersion).toBe(ADAPTER_API_VERSION)
    })
  })

  test('7: an asset-only bundle verifies without an mcpServers member', async () => {
    // The whole point of the compatibility window: an adapter published
    // before MCP existed still loads, and its missing capability field is
    // not a defect.
    await withBundle(
      assetOnlyAdapterSource(`  name: 'legacy', apiVersion: '${ADAPTER_API_VERSION_ASSETS_ONLY}',`),
      async (path) => {
        const result = await verifyAdapter(path)
        if (!result.ok) expect.unreachable()
        expect(result.verified.adapter.apiVersion).toBe(ADAPTER_API_VERSION_ASSETS_ONLY)
      },
    )
  })

  test('7: a current bundle without mcpServers fails as invalid-capability', async () => {
    await withBundle(
      assetOnlyAdapterSource(`  name: 'incomplete', apiVersion: '${ADAPTER_API_VERSION}',`),
      async (path) => {
        const result = await verifyAdapter(path)
        if (result.ok) expect.unreachable()
        if (result.failure.kind !== 'invalid-capability') expect.unreachable()
        expect(result.failure.adapter).toBe('incomplete')
        expect(result.failure.api).toBe(ADAPTER_API_VERSION)
        expect(result.failure.detail).toContain('mcpServers')
      },
    )
  })

  test('7: a partial MCP capability fails as invalid-capability', async () => {
    // A bundle need not come from the SDK factory, so the factory's
    // completeness guarantee is re-established here on untrusted input.
    await withBundle(
      `export default { name: 'partial', apiVersion: '${ADAPTER_API_VERSION}', mcpServers: { async prepare() {} },
       buildAssetMetadata() {}, async installAsset() {}, async readAsset() {}, async deleteAsset() {} }`,
      async (path) => {
        const result = await verifyAdapter(path)
        if (result.ok) expect.unreachable()
        if (result.failure.kind !== 'invalid-capability') expect.unreachable()
        expect(result.failure.detail).toContain('apply')
      },
    )
  })

  test('7: a current bundle declining MCP support verifies', async () => {
    await withBundle(
      `export default { name: 'declines', apiVersion: '${ADAPTER_API_VERSION}', mcpServers: false,
       buildAssetMetadata() {}, async installAsset() {}, async readAsset() {}, async deleteAsset() {} }`,
      async (path) => {
        const result = await verifyAdapter(path)
        if (!result.ok) expect.unreachable()
        if (result.verified.adapter.apiVersion !== ADAPTER_API_VERSION) expect.unreachable()
        expect(result.verified.adapter.mcpServers).toBe(false)
      },
    )
  })

  test('a throwing property getter becomes a structured failure, not an escaped throw', async () => {
    // A bundle is arbitrary code. If a hostile or broken getter could throw
    // out of the verifier, the one function whose job is to decide whether
    // to trust this object would itself be bypassed.
    await withBundle(
      `export default { get name() { throw new Error('hostile') }, apiVersion: '${ADAPTER_API_VERSION}',
       mcpServers: false, buildAssetMetadata() {}, async installAsset() {}, async readAsset() {}, async deleteAsset() {} }`,
      async (path) => {
        const result = await verifyAdapter(path)
        if (result.ok) expect.unreachable()
        expect(result.failure.kind).toBe('invalid-name')
      },
    )
  })

  test('a throwing mcpServers getter becomes a structured failure', async () => {
    await withBundle(
      `export default { name: 'hostile', apiVersion: '${ADAPTER_API_VERSION}',
       get mcpServers() { throw new Error('hostile') },
       buildAssetMetadata() {}, async installAsset() {}, async readAsset() {}, async deleteAsset() {} }`,
      async (path) => {
        const result = await verifyAdapter(path)
        if (result.ok) expect.unreachable()
        expect(result.failure.kind).toBe('invalid-capability')
      },
    )
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
