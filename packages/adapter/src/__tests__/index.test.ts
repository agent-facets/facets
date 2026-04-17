import { describe, expect, test } from 'bun:test'
import { defineAdapter } from '../define-adapter.ts'
import type { Adapter } from '../types.ts'

/**
 * A minimal valid adapter definition for tests that need a base object.
 * Overrides any individual field by spreading this then assigning.
 */
function validDefinition(): Adapter {
  return {
    name: 'test-adapter',
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset() {},
    async readAsset() {
      return { content: 'test' }
    },
    async deleteAsset() {},
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
      async installAsset() {},
      async readAsset() {
        return { content: 'test' }
      },
      async deleteAsset() {},
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
  function buildMinimal(overrides: Partial<Adapter> = {}): Adapter {
    const minimal = {
      name: 'stubbed-adapter',
      buildAssetMetadata: (data: unknown) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      ...overrides,
    }
    // biome-ignore lint/suspicious/noExplicitAny: intentionally construct a partial Adapter to test stub fallbacks
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
      },
      async readAsset() {
        readCalled = true
        return { content: 'real-content' }
      },
      async deleteAsset() {
        deleteCalled = true
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
