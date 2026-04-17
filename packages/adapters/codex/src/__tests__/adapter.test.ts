import { describe, expect, test } from 'bun:test'
import adapter from '../index.ts'

describe('codex adapter', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('codex')
  })

  test('buildAssetMetadata accepts any object', () => {
    const result = adapter.buildAssetMetadata({ custom: 'value', nested: { a: 1 } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ custom: 'value', nested: { a: 1 } })
    }
  })

  test('buildAssetMetadata accepts empty metadata', () => {
    const result = adapter.buildAssetMetadata({})
    expect(result.ok).toBe(true)
  })

  test('buildAssetMetadata accepts null as empty', () => {
    const result = adapter.buildAssetMetadata(null)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({})
    }
  })

  test('buildAssetMetadata accepts undefined as empty', () => {
    const result = adapter.buildAssetMetadata(undefined)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({})
    }
  })

  test('buildAssetMetadata rejects non-object values', () => {
    const result = adapter.buildAssetMetadata('not-an-object')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain('object')
    }
  })

  test('installAsset no-op stub resolves without throwing', async () => {
    await expect(adapter.installAsset('project', 'skill', 'foo', 'content', {})).resolves.toBeUndefined()
  })

  test('readAsset no-op stub returns placeholder content shape', async () => {
    const result = await adapter.readAsset('project', 'skill', 'foo')
    expect(typeof result.content).toBe('string')
  })

  test('deleteAsset no-op stub resolves without throwing', async () => {
    await expect(adapter.deleteAsset('project', 'skill', 'foo')).resolves.toBeUndefined()
  })
})
