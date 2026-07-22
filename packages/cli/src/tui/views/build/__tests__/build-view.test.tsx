import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { BuildView } from '../build-view.tsx'

/**
 * The adapter-incompatible preflight fires before any pipeline stage
 * touches disk, so these tests need no facet fixture — an incompatible
 * stub adapter is enough to exercise the distinct preflight rendering.
 */

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

function findContentFrame(frames: ReadonlyArray<string | undefined>): string {
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]
    if (frame !== undefined && frame.trim().length > 0) return frame
  }
  throw new Error(`no content frame found among ${frames.length} captured frames`)
}

/** An adapter whose runtime API declaration is unsupported. */
function incompatibleAdapter(name: string): Adapter {
  return {
    name,
    // Cast: the SDK type pins apiVersion to its canonical literal; the
    // preflight classifies this runtime value as unsupported.
    apiVersion: '9.9',
    buildAssetMetadata: () => ({ ok: true, data: {} }),
    installAsset: async () => undefined,
    readAsset: async () => ({ content: '' }),
    deleteAsset: async () => undefined,
  } as unknown as Adapter
}

describe('BuildView — adapter preflight rendering', () => {
  test('renders a distinct incompatibility block and does not fail "Parsing manifest"', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'facet-build-view-test-'))
    try {
      let failureCount = -1
      const { frames } = render(
        createElement(BuildView, {
          rootDir,
          adapters: [incompatibleAdapter('future-adapter')],
          onFailure: (count: number) => {
            failureCount = count
          },
        }),
      )
      await settle()
      const frame = findContentFrame(frames)
      // Distinct preflight block, not a stage failure.
      expect(frame).toContain('incompatible adapter')
      expect(frame).toContain('build did not start')
      expect(frame).toContain('future-adapter')
      // "Parsing manifest" must not be marked failed (✕).
      const parsingLine = frame.split('\n').find((l) => l.includes('Parsing manifest')) ?? ''
      expect(parsingLine).not.toContain('✕')
      expect(failureCount).toBe(1)
    } finally {
      await rm(rootDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
