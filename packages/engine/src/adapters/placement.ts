import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { facetAdaptersDir } from '../facet-dir.ts'

/** The filename for the bundled adapter file */
const ADAPTER_BUNDLE_FILENAME = 'adapter.js'

/**
 * Resolves the base directory for installed adapters: `$FACET_DIR/adapters/`.
 *
 * Delegates to `facetAdaptersDir()` (the single source of truth for the
 * facet directory tree). No per-subsystem env var — `FACET_DIR` is the
 * one override. Read on every call so test subprocesses with a different
 * `FACET_DIR` see the redirected path.
 *
 * A per-install `--target-dir` CLI flag was considered but deliberately
 * deferred: a per-install override would require persistent config so
 * that later invocations (`facet adapter list`, `facet build`, etc.)
 * could locate adapters installed to a non-default location. That
 * requires real config plumbing which isn't built yet.
 */
function resolveAdapterBaseDir(): string {
  return facetAdaptersDir()
}

/**
 * Returns the default base directory for all installed adapters.
 * Respects `FACET_DIR` if set.
 */
export function getAdapterBaseDir(): string {
  return resolveAdapterBaseDir()
}

/**
 * Returns the path to a specific adapter's directory.
 *
 * @param name - The adapter name
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 */
export function getAdapterDir(name: string, baseDir: string = resolveAdapterBaseDir()): string {
  return join(baseDir, name)
}

/**
 * Returns the path to an adapter's bundle file.
 *
 * @param name - The adapter name
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 */
export function getAdapterBundlePath(name: string, baseDir: string = resolveAdapterBaseDir()): string {
  return join(baseDir, name, ADAPTER_BUNDLE_FILENAME)
}

/**
 * Places a built adapter.js file into the installed adapters directory.
 *
 * @param name - The adapter name (used as the directory name)
 * @param bundlePath - Absolute path to the built adapter.js file
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 */
export async function placeAdapter(
  name: string,
  bundlePath: string,
  baseDir: string = resolveAdapterBaseDir(),
): Promise<void> {
  const adapterDir = getAdapterDir(name, baseDir)
  await mkdir(adapterDir, { recursive: true })

  const destPath = getAdapterBundlePath(name, baseDir)
  const content = await Bun.file(bundlePath).arrayBuffer()
  await Bun.write(destPath, content)
}

/**
 * Removes an installed adapter by deleting its directory.
 *
 * @param name - The adapter name to remove
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 * @returns true if the adapter was removed, false if it didn't exist
 */
export async function removeAdapter(name: string, baseDir: string = resolveAdapterBaseDir()): Promise<boolean> {
  const adapterDir = getAdapterDir(name, baseDir)
  const exists = await Bun.file(join(adapterDir, ADAPTER_BUNDLE_FILENAME)).exists()

  if (!exists) {
    return false
  }

  await rm(adapterDir, { recursive: true, force: true })
  return true
}

/**
 * Lists the names of all installed adapters by scanning the base directory.
 *
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 */
export async function listInstalledAdapters(baseDir: string = resolveAdapterBaseDir()): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(baseDir, { withFileTypes: true })
    const names: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Verify it has an adapter.js file
        const bundlePath = join(baseDir, entry.name, ADAPTER_BUNDLE_FILENAME)
        if (await Bun.file(bundlePath).exists()) {
          names.push(entry.name)
        }
      }
    }

    return names.sort()
  } catch {
    // Directory doesn't exist yet
    return []
  }
}
