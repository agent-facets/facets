import { describe, expect, test } from 'bun:test'
import harness from '../index.ts'

describe('opencode harness', () => {
  test('has correct name', () => {
    expect(harness.name).toBe('opencode')
  })

  test('buildAssetMetadata accepts valid metadata', () => {
    const result = harness.buildAssetMetadata({ tools: { grep: true, bash: false }, model: 'gpt-4' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ tools: { grep: true, bash: false }, model: 'gpt-4' })
    }
  })

  test('opencode.buildAssetMetadata accepts empty metadata', () => {
    const result = harness.buildAssetMetadata({})
    expect(result.ok).toBe(true)
  })

  test('buildAssetMetadata rejects invalid tools', () => {
    const result = harness.buildAssetMetadata({ tools: 'not-a-record' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  test('buildAssetMetadata rejects invalid model', () => {
    const result = harness.buildAssetMetadata({ model: 123 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
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
