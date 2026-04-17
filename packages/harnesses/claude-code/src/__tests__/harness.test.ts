import { describe, expect, test } from 'bun:test'
import harness from '../index.ts'

describe('claude-code harness', () => {
  test('has correct name', () => {
    expect(harness.name).toBe('claude-code')
  })

  test('buildAssetMetadata accepts valid metadata', () => {
    const result = harness.buildAssetMetadata({
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

  test('buildAssetMetadata rejects invalid permissions', () => {
    const result = harness.buildAssetMetadata({ permissions: 42 })
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
