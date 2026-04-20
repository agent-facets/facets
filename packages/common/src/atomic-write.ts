import { renameSync, writeFileSync } from 'node:fs'

/**
 * Atomic file write: write to `<path>.tmp` then rename over `path`.
 *
 * On POSIX, `renameSync` is atomic when both paths are on the same
 * filesystem. Modern Node.js and Bun on Windows implement `rename` via
 * `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` so the "rename fails when target
 * exists" lore from Node <= 10 no longer applies — but centralizing the
 * pattern still has value because every writer in the repo should behave
 * the same way, and adding `flush: true` / retry policy in one place is
 * easier than hunting down writers.
 */
export function atomicWriteFileSync(path: string, data: string, encoding: BufferEncoding = 'utf8'): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data, encoding)
  renameSync(tmp, path)
}
