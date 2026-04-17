import { describe, expect, test } from 'bun:test'
import harness from '../index.ts'

describe('codex harness', () => {
  test('has correct name', () => {
    expect(harness.name).toBe('codex')
  })

  test('buildAssetMetadata accepts any object', () => {
    const result = harness.buildAssetMetadata({ custom: 'value', nested: { a: 1 } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ custom: 'value', nested: { a: 1 } })
    }
  })

  test('buildAssetMetadata accepts empty metadata', () => {
    const result = harness.buildAssetMetadata({})
    expect(result.ok).toBe(true)
  })

  test('buildAssetMetadata accepts null as empty', () => {
    const result = harness.buildAssetMetadata(null)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({})
    }
  })

  test('buildAssetMetadata accepts undefined as empty', () => {
    const result = harness.buildAssetMetadata(undefined)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({})
    }
  })

  test('buildAssetMetadata rejects non-object values', () => {
    const result = harness.buildAssetMetadata('not-an-object')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain('object')
    }
  })

  test('installAsset no-op stub resolves without throwing', async () => {
    await expect(harness.installAsset('project', 'skill', 'foo', 'content', {})).resolves.toBeUndefined()
  })

  test('readAsset no-op stub returns placeholder content shape', async () => {
    const result = await harness.readAsset('project', 'skill', 'foo')
    expect(typeof result.content).toBe('string')
  })

  test('deleteAsset no-op stub resolves without throwing', async () => {
    await expect(harness.deleteAsset('project', 'skill', 'foo')).resolves.toBeUndefined()
  })
})
