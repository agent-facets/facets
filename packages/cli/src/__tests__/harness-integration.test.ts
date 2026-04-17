import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBuildPipeline } from '@agent-facets/core'
import { loadInstalledHarnesses } from '../commands/harness/loader.ts'
import { placeHarness } from '../commands/harness/placement.ts'
import { verifyHarness } from '../commands/harness/verify.ts'

/**
 * End-to-end integration test for the harness install → load → build chain.
 *
 * Proves that:
 * 1. A harness bundle can be placed into a configurable base directory
 * 2. `loadInstalledHarnesses(baseDir)` dynamically imports the bundle
 * 3. The loaded harness is passed to `runBuildPipeline` and its `buildAssetMetadata`
 *    is invoked against a matching `harnesses` section in the manifest
 *
 * Uses temporary directories so the user's real `~/.facets/harnesses/` is never touched.
 */

/**
 * Creates a minimal harness source file, bundles it into a self-contained
 * JavaScript file, and returns the bundle path.
 *
 * This bypasses the full `bundleHarness()` flow (which runs `bun install`) for
 * speed — we resolve the `@agent-facets/harness` source directly by absolute
 * path so `Bun.build()` can inline it without needing a temp `node_modules`.
 */
async function buildTestHarness(sourceDir: string, harnessName: string): Promise<string> {
  // Resolve the absolute path to the harness SDK source — this test file lives
  // at packages/cli/src/__tests__/harness-integration.test.ts, so the harness
  // package is four dirs up then into packages/harness/src/index.ts.
  const harnessSdkPath = Bun.fileURLToPath(new URL('../../../harness/src/index.ts', import.meta.url))

  const sourcePath = join(sourceDir, 'harness-source.ts')
  await Bun.write(
    sourcePath,
    `
import { defineHarness } from '${harnessSdkPath}'

export default defineHarness({
  name: '${harnessName}',
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
    throw new Error(`Failed to bundle test harness: ${buildResult.logs.map((l) => l.message).join('\n')}`)
  }

  const output = buildResult.outputs[0]
  if (!output) {
    throw new Error('Bun.build() produced no output')
  }
  return output.path
}

describe('harness install-load-build integration', () => {
  test('installed harness is loaded and used for manifest validation during build', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'facets-harness-integ-'))
    const harnessBaseDir = join(testRoot, 'harnesses-base')
    const harnessSourceDir = join(testRoot, 'harness-source')
    const facetDir = join(testRoot, 'facet')

    await mkdir(harnessBaseDir, { recursive: true })
    await mkdir(harnessSourceDir, { recursive: true })
    await mkdir(facetDir, { recursive: true })

    try {
      // Step 1: Build the test harness bundle
      const bundlePath = await buildTestHarness(harnessSourceDir, 'integ-test-harness')

      // Step 2: Verify the bundle exports a valid Harness (exercises the verify module)
      const verified = await verifyHarness(bundlePath)
      expect(verified.name).toBe('integ-test-harness')

      // Step 3: Place the bundle into the temp base directory
      await placeHarness(verified.name, bundlePath, harnessBaseDir)

      // Step 4: Load the harness back via loadInstalledHarnesses with the temp base dir
      const loaded = await loadInstalledHarnesses(harnessBaseDir)
      expect(loaded).toHaveLength(1)
      expect(loaded[0]?.name).toBe('integ-test-harness')

      // Step 5: Create a facet with harness metadata matching the installed harness
      await Bun.write(join(facetDir, 'skills/example/SKILL.md'), '# Example skill')
      await Bun.write(
        join(facetDir, 'facet.json'),
        JSON.stringify({
          name: 'integ-test-facet',
          version: '1.0.0',
          skills: {
            example: {
              description: 'An example skill',
              harnesses: {
                'integ-test-harness': { custom: 'hello' },
              },
            },
          },
        }),
      )

      // Step 6: Run the build pipeline with the loaded harnesses
      const result = await runBuildPipeline(facetDir, loaded)

      // Step 7: Assert build succeeded and no "unknown harness" warnings were produced
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.warnings.some((w) => w.includes('integ-test-harness'))).toBe(false)
      }
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  test('build fails when installed harness rejects metadata', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'facets-harness-integ-'))
    const harnessBaseDir = join(testRoot, 'harnesses-base')
    const harnessSourceDir = join(testRoot, 'harness-source')
    const facetDir = join(testRoot, 'facet')

    await mkdir(harnessBaseDir, { recursive: true })
    await mkdir(harnessSourceDir, { recursive: true })
    await mkdir(facetDir, { recursive: true })

    try {
      const bundlePath = await buildTestHarness(harnessSourceDir, 'integ-test-harness')
      const verified = await verifyHarness(bundlePath)
      await placeHarness(verified.name, bundlePath, harnessBaseDir)
      const loaded = await loadInstalledHarnesses(harnessBaseDir)

      // Manifest has invalid metadata for the harness (custom must be a string, not a number)
      await Bun.write(join(facetDir, 'skills/example/SKILL.md'), '# Example skill')
      await Bun.write(
        join(facetDir, 'facet.json'),
        JSON.stringify({
          name: 'integ-test-facet',
          version: '1.0.0',
          skills: {
            example: {
              description: 'An example skill',
              harnesses: {
                'integ-test-harness': { custom: 42 },
              },
            },
          },
        }),
      )

      const result = await runBuildPipeline(facetDir, loaded)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.some((e) => e.message.includes('integ-test-harness'))).toBe(true)
      }
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })
})
