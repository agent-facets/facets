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
      return undefined
    },
    async readAsset() {
      return { content: 'test' }
    },
    async deleteAsset() {
      return undefined
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
  test('ADAPTER_API_VERSION is 0.0', () => {
    expect(ADAPTER_API_VERSION).toBe('0.0')
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
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ foo: 'bar' })
    }
  })

  test('returns a frozen object', () => {
    const adapter = defineAdapter(validDefinition())
    expect(Object.isFrozen(adapter)).toBe(true)
  })

  test('buildAssetMetadata is bound to the definition (preserves "this")', () => {
    const definition = {
      name: 'bound-adapter',
      defaultValue: 'from-definition',
      buildAssetMetadata(this: { defaultValue: string }, _data: unknown) {
        // Reference `this` to prove the binding was preserved
        return {
          ok: true as const,
          data: { defaulted: this.defaultValue },
        }
      },
      async installAsset() {
        return undefined
      },
      async readAsset() {
        return { content: 'test' }
      },
      async deleteAsset() {
        return undefined
      },
    }
    const adapter = defineAdapter(definition)

    // Extract the method and call it without a receiver — if it wasn't bound,
    // `this` would be undefined and the call would throw.
    const buildMeta = adapter.buildAssetMetadata
    const result = buildMeta({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ defaulted: 'from-definition' })
    }
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

  test('installAsset falls back to a throw-on-call stub when omitted', async () => {
    const adapter = defineAdapter(buildMinimal())
    await expect(adapter.installAsset('project', 'skill', 'foo', 'content', {})).rejects.toThrow(
      /does not implement installAsset/,
    )
  })

  test('readAsset falls back to a throw-on-call stub when omitted', async () => {
    const adapter = defineAdapter(buildMinimal())
    await expect(adapter.readAsset('project', 'skill', 'foo')).rejects.toThrow(/does not implement readAsset/)
  })

  test('deleteAsset falls back to a throw-on-call stub when omitted', async () => {
    const adapter = defineAdapter(buildMinimal())
    await expect(adapter.deleteAsset('project', 'skill', 'foo')).rejects.toThrow(/does not implement deleteAsset/)
  })

  test('stub error message includes the adapter name', async () => {
    const adapter = defineAdapter(buildMinimal({ name: 'my-custom-adapter' }))
    await expect(adapter.installAsset('project', 'skill', 'foo', 'content', {})).rejects.toThrow(/"my-custom-adapter"/)
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
        return undefined
      },
      async readAsset() {
        readCalled = true
        return { content: 'real-content' }
      },
      async deleteAsset() {
        deleteCalled = true
        return undefined
      },
    })

    await adapter.installAsset('project', 'skill', 'foo', 'content', {})
    const read = await adapter.readAsset('project', 'skill', 'foo')
    await adapter.deleteAsset('project', 'skill', 'foo')

    expect(installCalled).toBe(true)
    expect(readCalled).toBe(true)
    expect(deleteCalled).toBe(true)
    expect(read.content).toBe('real-content')
  })
})
