import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadInstalledAdapters, placeAdapter, runBuildPipeline, verifyAdapter } from '@agent-facets/engine'

/**
 * End-to-end integration test for the adapter install → load → build chain.
 *
 * Proves that:
 * 1. An adapter bundle can be placed into a configurable base directory
 * 2. `loadInstalledAdapters(baseDir)` dynamically imports the bundle
 * 3. The loaded adapter is passed to `runBuildPipeline` and its `buildAssetMetadata`
 *    is invoked against a matching `adapters` section in the manifest
 *
 * Uses temporary directories so the user's real `~/.facet/adapters/` is never touched.
 */

/**
 * Creates a minimal adapter source file, bundles it into a self-contained
 * JavaScript file, and returns the bundle path.
 *
 * This bypasses the full `bundleAdapter()` flow (which runs `bun install`) for
 * speed — we resolve the `@agent-facets/adapter` source directly by absolute
 * path so `Bun.build()` can inline it without needing a temp `node_modules`.
 */
async function buildTestAdapter(sourceDir: string, adapterName: string): Promise<string> {
  // Resolve the absolute path to the adapter SDK source — this test file lives
  // at packages/cli/src/__tests__/adapter-integration.test.ts, so the adapter
  // package is four dirs up then into packages/adapter/src/index.ts.
  const adapterSdkPath = Bun.fileURLToPath(new URL('../../../adapter/src/index.ts', import.meta.url))

  const sourcePath = join(sourceDir, 'adapter-source.ts')
  await Bun.write(
    sourcePath,
    `
import { defineAdapter } from '${adapterSdkPath}'

export default defineAdapter({
  name: '${adapterName}',
  buildAssetMetadata(data) {
    const input = (data ?? {})
    if (input.custom !== undefined && typeof input.custom !== 'string') {
      return {
        ok: false,
        errors: [
          { path: 'custom', message: 'custom must be a string', expected: 'string', actual: typeof input.custom },
        ],
      }
    }
    return { ok: true, data: { custom: input.custom ?? 'default-value' } }
  },
})
`,
  )

  const buildResult = await Bun.build({
    entrypoints: [sourcePath],
    outdir: join(sourceDir, 'dist'),
    target: 'bun',
    format: 'esm',
  })

  if (!buildResult.success) {
    throw new Error(`Failed to bundle test adapter: ${buildResult.logs.map((l) => l.message).join('\n')}`)
  }

  const output = buildResult.outputs[0]
  if (!output) {
    throw new Error('Bun.build() produced no output')
  }
  return output.path
}

describe('adapter install-load-build integration', () => {
  test('installed adapter is loaded and used for manifest validation during build', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'facets-adapter-integ-'))
    const adapterBaseDir = join(testRoot, 'adapters-base')
    const adapterSourceDir = join(testRoot, 'adapter-source')
    const facetDir = join(testRoot, 'facet')

    await mkdir(adapterBaseDir, { recursive: true })
    await mkdir(adapterSourceDir, { recursive: true })
    await mkdir(facetDir, { recursive: true })

    try {
      // Step 1: Build the test adapter bundle
      const bundlePath = await buildTestAdapter(adapterSourceDir, 'integ-test-adapter')

      // Step 2: Verify the bundle exports a valid Adapter (exercises the verify module)
      const verified = await verifyAdapter(bundlePath)
      expect(verified.name).toBe('integ-test-adapter')

      // Step 3: Place the bundle into the temp base directory
      await placeAdapter(verified.name, bundlePath, adapterBaseDir)

      // Step 4: Load the adapter back via loadInstalledAdapters with the temp base dir
      const loaded = await loadInstalledAdapters(adapterBaseDir)
      expect(loaded).toHaveLength(1)
      expect(loaded[0]?.name).toBe('integ-test-adapter')

      // Step 5: Create a facet with adapter metadata matching the installed adapter
      await Bun.write(join(facetDir, 'skills/example/SKILL.md'), '# Example skill')
      await Bun.write(
        join(facetDir, 'facet.json'),
        JSON.stringify({
          name: 'integ-test-facet',
          version: '1.0.0',
          skills: {
            example: {
              description: 'An example skill',
              adapters: {
                'integ-test-adapter': { custom: 'hello' },
              },
            },
          },
        }),
      )

      // Step 6: Run the build pipeline with the loaded adapters
      const result = await runBuildPipeline(facetDir, loaded)

      // Step 7: Assert build succeeded and no "unknown adapter" warnings were produced
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.warnings.some((w) => w.includes('integ-test-adapter'))).toBe(false)
      }
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  test('build fails when installed adapter rejects metadata', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'facets-adapter-integ-'))
    const adapterBaseDir = join(testRoot, 'adapters-base')
    const adapterSourceDir = join(testRoot, 'adapter-source')
    const facetDir = join(testRoot, 'facet')

    await mkdir(adapterBaseDir, { recursive: true })
    await mkdir(adapterSourceDir, { recursive: true })
    await mkdir(facetDir, { recursive: true })

    try {
      const bundlePath = await buildTestAdapter(adapterSourceDir, 'integ-test-adapter')
      const verified = await verifyAdapter(bundlePath)
      await placeAdapter(verified.name, bundlePath, adapterBaseDir)
      const loaded = await loadInstalledAdapters(adapterBaseDir)

      // Manifest has invalid metadata for the adapter (custom must be a string, not a number)
      await Bun.write(join(facetDir, 'skills/example/SKILL.md'), '# Example skill')
      await Bun.write(
        join(facetDir, 'facet.json'),
        JSON.stringify({
          name: 'integ-test-facet',
          version: '1.0.0',
          skills: {
            example: {
              description: 'An example skill',
              adapters: {
                'integ-test-adapter': { custom: 42 },
              },
            },
          },
        }),
      )

      const result = await runBuildPipeline(facetDir, loaded)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.some((e) => e.message.includes('integ-test-adapter'))).toBe(true)
      }
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })
})
