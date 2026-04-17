import { resolve } from 'node:path'

/**
 * Validates and resolves a local filesystem path for adapter installation.
 * The path is resolved to an absolute path relative to cwd.
 *
 * @param inputPath - The path as provided by the user (relative or absolute)
 * @returns The resolved absolute path to the adapter source directory.
 */
export async function resolveLocalPath(inputPath: string): Promise<string> {
  const absolutePath = resolve(inputPath)

  const file = Bun.file(absolutePath)
  const exists = await file.exists()

  if (!exists) {
    // Check if it's a directory (Bun.file doesn't work on directories)
    const dir = Bun.file(`${absolutePath}/package.json`)
    const dirExists = await dir.exists()
    if (!dirExists) {
      throw new Error(`Local path "${inputPath}" does not exist or is not an adapter package (no package.json found)`)
    }
  }

  return absolutePath
}
