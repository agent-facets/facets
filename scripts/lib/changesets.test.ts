import { describe, expect, test } from 'bun:test'
import { filterPendingChangesets, hasUnpublishedVersions, shouldPublish, type WorkspacePackage } from './changesets'

describe('filterPendingChangesets', () => {
  test('returns empty array when no files', () => {
    expect(filterPendingChangesets([])).toEqual([])
  })

  test('filters out README.md', () => {
    expect(filterPendingChangesets(['README.md'])).toEqual([])
  })

  test('returns only .md files that are not README.md', () => {
    const files = ['README.md', 'funny-turtle.md', 'brave-lion.md']
    expect(filterPendingChangesets(files)).toEqual(['funny-turtle.md', 'brave-lion.md'])
  })

  test('filters out non-.md files', () => {
    const files = ['funny-turtle.md', 'config.json', 'notes.txt']
    expect(filterPendingChangesets(files)).toEqual(['funny-turtle.md'])
  })

  test('handles mix of everything', () => {
    const files = ['README.md', 'funny-turtle.md', 'config.json', 'brave-lion.md', '.gitkeep']
    expect(filterPendingChangesets(files)).toEqual(['funny-turtle.md', 'brave-lion.md'])
  })
})

describe('shouldPublish', () => {
  test('returns true when no pending changesets', () => {
    expect(shouldPublish([])).toBe(true)
  })

  test('returns false when there are pending changesets', () => {
    expect(shouldPublish(['funny-turtle.md'])).toBe(false)
  })

  test('returns false when multiple pending changesets', () => {
    expect(shouldPublish(['funny-turtle.md', 'brave-lion.md'])).toBe(false)
  })
})

describe('hasUnpublishedVersions', () => {
  const mockNpm = (registry: Record<string, string>) => {
    return async (pkg: string): Promise<string | null> => registry[pkg] ?? null
  }

  test('returns false when all versions match npm', async () => {
    const packages: WorkspacePackage[] = [
      { name: '@agent-facets/core', version: '0.1.1' },
      { name: 'agent-facets', version: '0.1.1' },
    ]
    const result = await hasUnpublishedVersions(
      packages,
      mockNpm({ '@agent-facets/core': '0.1.1', 'agent-facets': '0.1.1' }),
    )
    expect(result).toBe(false)
  })

  test('returns true when one version is ahead of npm', async () => {
    const packages: WorkspacePackage[] = [
      { name: '@agent-facets/core', version: '0.2.0' },
      { name: 'agent-facets', version: '0.1.1' },
    ]
    const result = await hasUnpublishedVersions(
      packages,
      mockNpm({ '@agent-facets/core': '0.1.1', 'agent-facets': '0.1.1' }),
    )
    expect(result).toBe(true)
  })

  test('returns true when package is not on npm yet', async () => {
    const packages: WorkspacePackage[] = [{ name: '@agent-facets/brand', version: '0.1.0' }]
    const result = await hasUnpublishedVersions(packages, mockNpm({}))
    expect(result).toBe(true)
  })

  test('skips private packages', async () => {
    const packages: WorkspacePackage[] = [
      { name: 'private-pkg', version: '1.0.0', private: true },
      { name: '@agent-facets/core', version: '0.1.1' },
    ]
    const result = await hasUnpublishedVersions(packages, mockNpm({ '@agent-facets/core': '0.1.1' }))
    expect(result).toBe(false)
  })

  test('returns false for empty package list', async () => {
    const result = await hasUnpublishedVersions([], mockNpm({}))
    expect(result).toBe(false)
  })
})
