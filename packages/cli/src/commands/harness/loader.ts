import type { Harness } from '@agent-facets/harness'
import { getHarnessBundlePath, listInstalledHarnesses } from './placement.ts'

/**
 * Loads all installed harnesses by scanning the harness base directory
 * and dynamically importing each `harness.js` bundle.
 *
 * @param baseDir - Base directory for installed harnesses (defaults to `~/.facets/harnesses`)
 * @returns Array of loaded Harness objects
 */
export async function loadInstalledHarnesses(baseDir?: string): Promise<Harness[]> {
  const names = await listInstalledHarnesses(baseDir)
  const harnesses: Harness[] = []

  for (const name of names) {
    const bundlePath = getHarnessBundlePath(name, baseDir)
    try {
      const module = (await import(bundlePath)) as { default?: Harness }
      if (module.default) {
        harnesses.push(module.default)
      } else {
        console.error(`Warning: Installed harness "${name}" has an invalid export, skipping.`)
      }
    } catch (err) {
      console.error(
        `Warning: Failed to load installed harness "${name}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return harnesses
}
