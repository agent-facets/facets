import { describe, expect, test } from 'bun:test'
import adapter from '../index.ts'

describe('opencode adapter', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('opencode')
  })

  test('buildAssetMetadata accepts valid metadata', () => {
    const result = adapter.buildAssetMetadata({ tools: { grep: true, bash: false }, model: 'gpt-4' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ tools: { grep: true, bash: false }, model: 'gpt-4' })
    }
  })

  test('opencode.buildAssetMetadata accepts empty metadata', () => {
    const result = adapter.buildAssetMetadata({})
    expect(result.ok).toBe(true)
  })

  test('buildAssetMetadata rejects invalid tools', () => {
    const result = adapter.buildAssetMetadata({ tools: 'not-a-record' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  test('buildAssetMetadata rejects invalid model', () => {
    const result = adapter.buildAssetMetadata({ model: 123 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
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
