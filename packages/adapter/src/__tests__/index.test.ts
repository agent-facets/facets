import { describe, expect, test } from 'bun:test'
import { ADAPTER_API_VERSION, ADAPTER_API_VERSION_PACKAGE_FIELD } from '../api-version.ts'
import { defineAdapter } from '../define-adapter.ts'
import type { AdapterDefinition } from '../types.ts'

/**
 * A minimal valid adapter definition for tests that need a base object.
 * Overrides any individual field by spreading this then assigning.
 */
function validDefinition(): AdapterDefinition {
  return {
    name: 'test-adapter',
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset() {
      return { ok: true, primaryPath: '/tmp/test' }
    },
    async readAsset() {
      return { ok: true, asset: { assetType: 'agent', content: 'test' } }
    },
    async deleteAsset() {
      return { ok: true, existed: true, deletedPaths: ['/tmp/test'] }
    },
  }
}

describe('defineAdapter — required field validation', () => {
  test('throws when name is missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), name: undefined as any }
    expect(() => defineAdapter(def)).toThrow(/"name" is required/)
  })

  test('throws when name is an empty string', () => {
    expect(() => defineAdapter({ ...validDefinition(), name: '' })).toThrow(/"name" is required/)
  })

  test('throws when name is not a string', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), name: 42 as any }
    expect(() => defineAdapter(def)).toThrow(/"name" is required/)
  })

  test('throws when buildAssetMetadata is missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), buildAssetMetadata: undefined as any }
    expect(() => defineAdapter(def)).toThrow(/"buildAssetMetadata" is required/)
  })

  test('throws when buildAssetMetadata is not a function', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), buildAssetMetadata: 'not-a-function' as any }
    expect(() => defineAdapter(def)).toThrow(/"buildAssetMetadata" is required/)
  })
})

describe('canonical adapter API constants', () => {
  // The one place tests anchor the spec literals — everywhere else compares
  // against the exported constants.
  test('ADAPTER_API_VERSION is 0.1', () => {
    expect(ADAPTER_API_VERSION).toBe('0.1')
  })

  test('ADAPTER_API_VERSION_PACKAGE_FIELD is facetAdapterApiVersion', () => {
    expect(ADAPTER_API_VERSION_PACKAGE_FIELD).toBe('facetAdapterApiVersion')
  })
})

describe('defineAdapter — API version stamping', () => {
  test('stamps the canonical API version onto the returned adapter', () => {
    const adapter = defineAdapter(validDefinition())
    expect(adapter.apiVersion).toBe(ADAPTER_API_VERSION)
  })

  test('the definition type excludes apiVersion', () => {
    // @ts-expect-error — apiVersion is SDK-owned; authors cannot supply it
    const definition: Parameters<typeof defineAdapter>[0] = { ...validDefinition(), apiVersion: '9.9' }
    // Runtime still stamps the canonical value even when the type is bypassed
    expect(defineAdapter(definition).apiVersion).toBe(ADAPTER_API_VERSION)
  })

  test('a conflicting runtime apiVersion smuggled past the types is overwritten', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole to prove the stamp wins at runtime
    const definition = { ...validDefinition(), apiVersion: '1.0' } as any
    const adapter = defineAdapter(definition)
    expect(adapter.apiVersion).toBe(ADAPTER_API_VERSION)
  })
})

describe('defineAdapter — returned adapter shape', () => {
  test('preserves name', () => {
    const adapter = defineAdapter({ ...validDefinition(), name: 'my-adapter' })
    expect(adapter.name).toBe('my-adapter')
  })

  test('buildAssetMetadata is callable after creation', () => {
    const adapter = defineAdapter(validDefinition())
    const result = adapter.buildAssetMetadata({ foo: 'bar' })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({ foo: 'bar' })
  })

  test('returns a frozen object', () => {
    const adapter = defineAdapter(validDefinition())
    expect(Object.isFrozen(adapter)).toBe(true)
  })

  test('buildAssetMetadata is bound to the definition (preserves "this")', () => {
    const definition: AdapterDefinition & { defaultValue: string } = {
      ...validDefinition(),
      name: 'bound-adapter',
      defaultValue: 'from-definition',
      buildAssetMetadata(this: { defaultValue: string }, _data: unknown) {
        // Reference `this` to prove the binding was preserved
        return {
          ok: true as const,
          data: { defaulted: this.defaultValue },
        }
      },
    }
    const adapter = defineAdapter(definition)

    // Extract the method and call it without a receiver — if it wasn't bound,
    // `this` would be undefined and the call would throw.
    const buildMeta = adapter.buildAssetMetadata
    const result = buildMeta({})
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({ defaulted: 'from-definition' })
  })
})

describe('defineAdapter — stub fallbacks for missing asset methods', () => {
  function buildMinimal(overrides: Partial<AdapterDefinition> = {}): AdapterDefinition {
    const minimal = {
      name: 'stubbed-adapter',
      buildAssetMetadata: (data: unknown) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      ...overrides,
    }
    // biome-ignore lint/suspicious/noExplicitAny: intentionally construct a partial definition to test stub fallbacks
    return minimal as any
  }

  test('installAsset falls back to a structured not-implemented result when omitted', async () => {
    const adapter = defineAdapter(buildMinimal())
    const result = await adapter.installAsset({
      assetType: 'agent',
      scope: 'project',
      name: 'foo',
      content: 'content',
      metadata: {},
    })
    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'not-implemented', method: 'installAsset' })
  })

  test('readAsset falls back to a structured not-implemented result when omitted', async () => {
    const adapter = defineAdapter(buildMinimal())
    const result = await adapter.readAsset({ assetType: 'agent', scope: 'project', name: 'foo' })
    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'not-implemented', method: 'readAsset' })
  })

  test('deleteAsset falls back to a structured not-implemented result when omitted', async () => {
    const adapter = defineAdapter(buildMinimal())
    const result = await adapter.deleteAsset({ assetType: 'agent', scope: 'project', name: 'foo' })
    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'not-implemented', method: 'deleteAsset' })
  })

  test('provided asset methods are used instead of the stub fallback', async () => {
    let installCalled = false
    let readCalled = false
    let deleteCalled = false

    const adapter = defineAdapter({
      name: 'impl-adapter',
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      async installAsset() {
        installCalled = true
        return { ok: true, primaryPath: '/tmp/foo' }
      },
      async readAsset() {
        readCalled = true
        return { ok: true, asset: { assetType: 'command', content: 'real-content' } }
      },
      async deleteAsset() {
        deleteCalled = true
        return { ok: true, existed: false, deletedPaths: [] }
      },
    })

    await adapter.installAsset({ assetType: 'command', scope: 'project', name: 'foo', content: 'c', metadata: {} })
    const read = await adapter.readAsset({ assetType: 'command', scope: 'project', name: 'foo' })
    await adapter.deleteAsset({ assetType: 'command', scope: 'project', name: 'foo' })

    expect(installCalled).toBe(true)
    expect(readCalled).toBe(true)
    expect(deleteCalled).toBe(true)
    if (!read.ok) expect.unreachable()
    expect(read.asset.content).toBe('real-content')
  })
})
