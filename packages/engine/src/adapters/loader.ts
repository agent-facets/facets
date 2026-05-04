import type { Adapter } from '@agent-facets/adapter'
import { getAdapterBundlePath, listInstalledAdapters } from './placement.ts'

/**
 * Loads all installed adapters by scanning the adapter base directory
 * and dynamically importing each `adapter.js` bundle.
 *
 * @param baseDir - Base directory for installed adapters (defaults to `~/.facets/adapters`)
 * @param opts.onWarn - Optional callback for warnings about adapters that
 *   couldn't be loaded (e.g. invalid export, dynamic import failure). The
 *   CLI passes a callback that writes to stderr; tests can pass a no-op
 *   or array collector. When omitted, warnings are silently swallowed
 *   (preferable to a hardcoded `console.error` because callers may want
 *   to route warnings through their own logging infrastructure).
 */
export async function loadInstalledAdapters(
  baseDir?: string,
  opts: { onWarn?: (line: string) => void } = {},
): Promise<Adapter[]> {
  const names = await listInstalledAdapters(baseDir)
  const adapters: Adapter[] = []

  for (const name of names) {
    const bundlePath = getAdapterBundlePath(name, baseDir)
    try {
      const module = (await import(bundlePath)) as { default?: Adapter }
      if (module.default) {
        adapters.push(module.default)
      } else {
        opts.onWarn?.(`Warning: Installed adapter "${name}" has an invalid export, skipping.`)
      }
    } catch (err) {
      opts.onWarn?.(
        `Warning: Failed to load installed adapter "${name}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return adapters
}
