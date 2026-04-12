import { resolve } from 'node:path'
import type { Harness } from '@agent-facets/harness'
import { HARNESS_API_VERSION as BUNDLED_API_VERSION } from '@agent-facets/harness'
import type { Command } from '../commands.ts'

/**
 * Spike command: test dynamic import of a harness.
 *
 * Usage: facet spike-adapter <path-to-harness>
 *
 * The path should point to the harness's entry file (e.g., index.ts).
 * This command dynamically import()s the harness at runtime and prints its info.
 */
export const spikeAdapterCommand: Command = {
  name: 'spike-adapter',
  description: '[SPIKE] Test dynamic import of a harness',
  usage: 'facet spike-adapter <path-to-harness-entry>',
  run: async (args, _flags) => {
    const harnessPath = args[0]
    if (!harnessPath) {
      console.error('Usage: facet spike-adapter <path-to-harness-entry>')
      console.error('Example: facet spike-adapter /absolute/path/to/harnesses/opencode/src/index.ts')
      return 1
    }

    const absolutePath = resolve(harnessPath)
    console.log(`[spike] CLI binary has @agent-facets/harness bundled: HARNESS_API_VERSION=${BUNDLED_API_VERSION}`)
    console.log(`[spike] Attempting dynamic import from: ${absolutePath}`)

    try {
      const mod = await import(absolutePath)
      const harness: Harness = mod.default

      if (!harness?.name) {
        console.error('[spike] FAIL: Imported module does not export a valid Harness')
        console.error('[spike] Got:', JSON.stringify(mod, null, 2))
        return 1
      }

      console.log(`[spike] SUCCESS: Harness loaded dynamically`)
      console.log(`[spike]   name: ${harness.name}`)
      console.log(`[spike]   rootDir: ${harness.rootDir}`)

      // Check if HARNESS_API_VERSION was resolved at runtime (not a type-only import)
      const apiVersion = mod.HARNESS_API_VERSION
      console.log(`[spike]   HARNESS_API_VERSION (runtime value from @agent-facets/harness): ${apiVersion}`)
      if (!apiVersion) {
        console.error(
          '[spike] WARNING: HARNESS_API_VERSION is undefined — runtime import of @agent-facets/harness may not have resolved',
        )
      }

      const available = await harness.isAvailable(process.cwd())
      console.log(`[spike]   isAvailable(cwd): ${available}`)

      const skillPath = harness.assetPath('skills', 'example-skill')
      console.log(`[spike]   assetPath('skills', 'example-skill'): ${skillPath}`)

      const agentPath = harness.assetPath('agents', 'example-agent')
      console.log(`[spike]   assetPath('agents', 'example-agent'): ${agentPath}`)

      return 0
    } catch (err) {
      console.error(`[spike] FAIL: Dynamic import threw an error`)
      console.error(`[spike] Error:`, err)
      return 1
    }
  },
}
