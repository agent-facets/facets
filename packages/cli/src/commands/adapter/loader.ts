import type { Adapter } from '@agent-facets/adapter'
import { getAdapterBundlePath, listInstalledAdapters } from './placement.ts'

/**
 * Loads all installed adapters by scanning the adapter base directory
 * and dynamically importing each `adapter.js` bundle.
 *
 * @param baseDir - Base directory for installed adapters (defaults to `~/.facets/adapters`)
 * @returns Array of loaded Adapter objects
 */
export async function loadInstalledAdapters(baseDir?: string): Promise<Adapter[]> {
  const names = await listInstalledAdapters(baseDir)
  const adapters: Adapter[] = []

  for (const name of names) {
    const bundlePath = getAdapterBundlePath(name, baseDir)
    try {
      const module = (await import(bundlePath)) as { default?: Adapter }
      if (module.default) {
        adapters.push(module.default)
      } else {
        console.error(`Warning: Installed adapter "${name}" has an invalid export, skipping.`)
      }
    } catch (err) {
      console.error(
        `Warning: Failed to load installed adapter "${name}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return adapters
}
