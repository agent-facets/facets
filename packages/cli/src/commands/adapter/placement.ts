import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default base directory for installed adapters */
const ADAPTER_BASE_DIR = join(homedir(), '.facets', 'adapters')

/** The filename for the bundled adapter file */
const ADAPTER_BUNDLE_FILENAME = 'adapter.js'

/**
 * Returns the default base directory for all installed adapters.
 */
export function getAdapterBaseDir(): string {
  return ADAPTER_BASE_DIR
}

/**
 * Returns the path to a specific adapter's directory.
 *
 * @param name - The adapter name
 * @param baseDir - Base directory for installed adapters (defaults to `~/.facets/adapters`)
 */
export function getAdapterDir(name: string, baseDir: string = ADAPTER_BASE_DIR): string {
  return join(baseDir, name)
}

/**
 * Returns the path to an adapter's bundle file.
 *
 * @param name - The adapter name
 * @param baseDir - Base directory for installed adapters (defaults to `~/.facets/adapters`)
 */
export function getAdapterBundlePath(name: string, baseDir: string = ADAPTER_BASE_DIR): string {
  return join(baseDir, name, ADAPTER_BUNDLE_FILENAME)
}

/**
 * Places a built adapter.js file into the installed adapters directory.
 *
 * @param name - The adapter name (used as the directory name)
 * @param bundlePath - Absolute path to the built adapter.js file
 * @param baseDir - Base directory for installed adapters (defaults to `~/.facets/adapters`)
 */
export async function placeAdapter(
  name: string,
  bundlePath: string,
  baseDir: string = ADAPTER_BASE_DIR,
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
 * @param baseDir - Base directory for installed adapters (defaults to `~/.facets/adapters`)
 * @returns true if the adapter was removed, false if it didn't exist
 */
export async function removeAdapter(name: string, baseDir: string = ADAPTER_BASE_DIR): Promise<boolean> {
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
 * @param baseDir - Base directory for installed adapters (defaults to `~/.facets/adapters`)
 */
export async function listInstalledAdapters(baseDir: string = ADAPTER_BASE_DIR): Promise<string[]> {
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
