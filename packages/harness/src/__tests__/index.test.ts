import { describe, expect, test } from 'bun:test'
import { defineHarness } from '../define-harness.ts'
import type { Harness } from '../types.ts'

/**
 * A minimal valid harness definition for tests that need a base object.
 * Overrides any individual field by spreading this then assigning.
 */
function validDefinition(): Harness {
  return {
    name: 'test-harness',
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset() {},
    async readAsset() {
      return { content: 'test' }
    },
    async deleteAsset() {},
  }
}

describe('defineHarness — required field validation', () => {
  test('throws when name is missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), name: undefined as any }
    expect(() => defineHarness(def)).toThrow(/"name" is required/)
  })

  test('throws when name is an empty string', () => {
    expect(() => defineHarness({ ...validDefinition(), name: '' })).toThrow(/"name" is required/)
  })

  test('throws when name is not a string', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), name: 42 as any }
    expect(() => defineHarness(def)).toThrow(/"name" is required/)
  })

  test('throws when buildAssetMetadata is missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), buildAssetMetadata: undefined as any }
    expect(() => defineHarness(def)).toThrow(/"buildAssetMetadata" is required/)
  })

  test('throws when buildAssetMetadata is not a function', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), buildAssetMetadata: 'not-a-function' as any }
    expect(() => defineHarness(def)).toThrow(/"buildAssetMetadata" is required/)
  })
})

describe('defineHarness — returned harness shape', () => {
  test('preserves name', () => {
    const harness = defineHarness({ ...validDefinition(), name: 'my-harness' })
    expect(harness.name).toBe('my-harness')
  })

  test('buildAssetMetadata is callable after creation', () => {
    const harness = defineHarness(validDefinition())
    const result = harness.buildAssetMetadata({ foo: 'bar' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ foo: 'bar' })
    }
  })

  test('returns a frozen object', () => {
    const harness = defineHarness(validDefinition())
    expect(Object.isFrozen(harness)).toBe(true)
  })

  test('buildAssetMetadata is bound to the definition (preserves "this")', () => {
    const definition = {
      name: 'bound-harness',
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
    const harness = defineHarness(definition)

    // Extract the method and call it without a receiver — if it wasn't bound,
    // `this` would be undefined and the call would throw.
    const buildMeta = harness.buildAssetMetadata
    const result = buildMeta({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ defaulted: 'from-definition' })
    }
  })
})

describe('defineHarness — stub fallbacks for missing asset methods', () => {
  function buildMinimal(overrides: Partial<Harness> = {}): Harness {
    const minimal = {
      name: 'stubbed-harness',
      buildAssetMetadata: (data: unknown) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      ...overrides,
    }
    // biome-ignore lint/suspicious/noExplicitAny: intentionally construct a partial Harness to test stub fallbacks
    return minimal as any
  }

  test('installAsset falls back to a throw-on-call stub when omitted', async () => {
    const harness = defineHarness(buildMinimal())
    await expect(harness.installAsset('project', 'skill', 'foo', 'content', {})).rejects.toThrow(
      /does not implement installAsset/,
    )
  })

  test('readAsset falls back to a throw-on-call stub when omitted', async () => {
    const harness = defineHarness(buildMinimal())
    await expect(harness.readAsset('project', 'skill', 'foo')).rejects.toThrow(/does not implement readAsset/)
  })

  test('deleteAsset falls back to a throw-on-call stub when omitted', async () => {
    const harness = defineHarness(buildMinimal())
    await expect(harness.deleteAsset('project', 'skill', 'foo')).rejects.toThrow(/does not implement deleteAsset/)
  })

  test('stub error message includes the harness name', async () => {
    const harness = defineHarness(buildMinimal({ name: 'my-custom-harness' }))
    await expect(harness.installAsset('project', 'skill', 'foo', 'content', {})).rejects.toThrow(/"my-custom-harness"/)
  })

  test('provided asset methods are used instead of the stub fallback', async () => {
    let installCalled = false
    let readCalled = false
    let deleteCalled = false

    const harness = defineHarness({
      name: 'impl-harness',
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

    await harness.installAsset('project', 'skill', 'foo', 'content', {})
    const read = await harness.readAsset('project', 'skill', 'foo')
    await harness.deleteAsset('project', 'skill', 'foo')

    expect(installCalled).toBe(true)
    expect(readCalled).toBe(true)
    expect(deleteCalled).toBe(true)
    expect(read.content).toBe('real-content')
  })
})
