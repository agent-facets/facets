import { renameSync, writeFileSync } from 'node:fs'

/**
 * Atomic file write: write to `<path>.tmp` then rename over `path`.
 *
 * Mirrors `atomicWriteFileSync` in `@agent-facets/common`. Inlined here
 * because the `.opencode/` plugin runtime is intentionally isolated
 * from the monorepo workspaces (its own package.json, its own
 * node_modules) and we don't want to couple plugin tools to the
 * monorepo just for four lines of fs.
 */
export function atomicWriteFileSync(path: string, data: string, encoding: BufferEncoding = 'utf8'): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data, encoding)
  renameSync(tmp, path)
}
