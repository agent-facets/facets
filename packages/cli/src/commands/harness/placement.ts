import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default base directory for installed harnesses */
const HARNESS_BASE_DIR = join(homedir(), '.facets', 'harnesses')

/** The filename for the bundled harness file */
const HARNESS_BUNDLE_FILENAME = 'harness.js'

/**
 * Returns the default base directory for all installed harnesses.
 */
export function getHarnessBaseDir(): string {
  return HARNESS_BASE_DIR
}

/**
 * Returns the path to a specific harness's directory.
 *
 * @param name - The harness name
 * @param baseDir - Base directory for installed harnesses (defaults to `~/.facets/harnesses`)
 */
export function getHarnessDir(name: string, baseDir: string = HARNESS_BASE_DIR): string {
  return join(baseDir, name)
}

/**
 * Returns the path to a harness's bundle file.
 *
 * @param name - The harness name
 * @param baseDir - Base directory for installed harnesses (defaults to `~/.facets/harnesses`)
 */
export function getHarnessBundlePath(name: string, baseDir: string = HARNESS_BASE_DIR): string {
  return join(baseDir, name, HARNESS_BUNDLE_FILENAME)
}

/**
 * Places a built harness.js file into the installed harnesses directory.
 *
 * @param name - The harness name (used as the directory name)
 * @param bundlePath - Absolute path to the built harness.js file
 * @param baseDir - Base directory for installed harnesses (defaults to `~/.facets/harnesses`)
 */
export async function placeHarness(
  name: string,
  bundlePath: string,
  baseDir: string = HARNESS_BASE_DIR,
): Promise<void> {
  const harnessDir = getHarnessDir(name, baseDir)
  await mkdir(harnessDir, { recursive: true })

  const destPath = getHarnessBundlePath(name, baseDir)
  const content = await Bun.file(bundlePath).arrayBuffer()
  await Bun.write(destPath, content)
}

/**
 * Removes an installed harness by deleting its directory.
 *
 * @param name - The harness name to remove
 * @param baseDir - Base directory for installed harnesses (defaults to `~/.facets/harnesses`)
 * @returns true if the harness was removed, false if it didn't exist
 */
export async function removeHarness(name: string, baseDir: string = HARNESS_BASE_DIR): Promise<boolean> {
  const harnessDir = getHarnessDir(name, baseDir)
  const exists = await Bun.file(join(harnessDir, HARNESS_BUNDLE_FILENAME)).exists()

  if (!exists) {
    return false
  }

  await rm(harnessDir, { recursive: true, force: true })
  return true
}

/**
 * Lists the names of all installed harnesses by scanning the base directory.
 *
 * @param baseDir - Base directory for installed harnesses (defaults to `~/.facets/harnesses`)
 */
export async function listInstalledHarnesses(baseDir: string = HARNESS_BASE_DIR): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(baseDir, { withFileTypes: true })
    const names: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Verify it has a harness.js file
        const bundlePath = join(baseDir, entry.name, HARNESS_BUNDLE_FILENAME)
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
