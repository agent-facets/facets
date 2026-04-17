import { describe, expect, test } from 'bun:test'
import adapter from '../index.ts'

describe('claude-code adapter', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('claude-code')
  })

  test('buildAssetMetadata accepts valid metadata', () => {
    const result = adapter.buildAssetMetadata({
      tools: { Bash: true, Read: false },
      permissions: { allow: true },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        tools: { Bash: true, Read: false },
        permissions: { allow: true },
      })
    }
  })

  test('buildAssetMetadata accepts empty metadata', () => {
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

  test('buildAssetMetadata rejects invalid permissions', () => {
    const result = adapter.buildAssetMetadata({ permissions: 42 })
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
