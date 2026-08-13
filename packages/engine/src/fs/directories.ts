import { dirname, relative, sep } from 'node:path'
import { errorCode, errorMessage, type InspectFileFailure, isNotFound } from '@agent-facets/common'
import { type FileOperationFailure, type FsSyscalls, operationFailure } from './syscalls.ts'

/**
 * Directories are tracked separately from files, and far more conservatively.
 *
 * The journal is file-oriented: a directory is not a state a plan targets, it
 * is a thing that had to exist so a file could. So the transaction records
 * only the directories it can prove it created, and after a rollback removes
 * only those, only while they are still empty, and only while they are still
 * the very directories it made.
 *
 * "Still the very ones" is why identity travels with the path. An empty
 * directory at a path we created is not necessarily ours — it can have been
 * removed and recreated by something else in between — and removing it on the
 * strength of the path alone is the same mistake as restoring a file on the
 * strength of it merely differing.
 */

/** A directory this transaction created, with the identity it had when created. */
export interface CreatedDirectory {
  readonly path: string
  readonly boundary: string
  readonly dev: number
  readonly ino: number
}

export type EnsureDirectoriesResult =
  | { ok: true; created: readonly CreatedDirectory[] }
  | { ok: false; failure: FileOperationFailure }
  | { ok: false; inspection: InspectFileFailure }

/** The components strictly between `boundary` and `target`, outermost first. */
function componentsBelow(boundary: string, target: string): string[] | null {
  const rel = relative(boundary, target)
  if (rel === '') return []
  if (rel.startsWith('..') || rel.startsWith(`${sep}..`)) return null
  return rel.split(sep).filter((part) => part.length > 0)
}

/**
 * Verify every directory component between `boundary` and `path`'s parent.
 *
 * The boundary's OWN ancestors are deliberately not checked. A user may keep
 * `~/.claude` as a symlink into a dotfiles repository, and macOS reaches
 * `/var` through one — rejecting those would refuse legitimate setups while
 * proving nothing about containment. What matters is that nothing *below* the
 * authorized boundary redirects a write somewhere else.
 */
export function inspectAncestors(
  path: string,
  boundary: string,
  sys: FsSyscalls,
): { ok: true } | { ok: false; failure: InspectFileFailure } {
  const parts = componentsBelow(boundary, dirname(path))
  if (parts === null) {
    return { ok: false, failure: { reason: 'parent-unusable', path, component: dirname(path) } }
  }

  let current = boundary
  for (const part of parts) {
    current = `${current}${sep}${part}`
    let stats: ReturnType<FsSyscalls['lstat']>
    try {
      stats = sys.lstat(current)
    } catch (error) {
      // Missing here means missing all the way down; the write will create it.
      if (isNotFound(error)) return { ok: true }
      if (errorCode(error) === 'ENOTDIR') {
        return { ok: false, failure: { reason: 'parent-unusable', path, component: current } }
      }
      return {
        ok: false,
        failure: { reason: 'unreadable', path, code: errorCode(error), message: errorMessage(error) },
      }
    }
    if (stats.isSymbolicLink()) {
      return { ok: false, failure: { reason: 'symlinked-ancestor', path, component: current } }
    }
    if (!stats.isDirectory()) {
      return { ok: false, failure: { reason: 'parent-unusable', path, component: current } }
    }
  }
  return { ok: true }
}

/**
 * Create the directories `path` needs, one component at a time.
 *
 * Non-recursive on purpose: `mkdir -p` reports at most the first directory it
 * made, and the transaction needs the identity of every one of them. Creating
 * them individually is also what lets a component that turns out to be a
 * symlink stop the walk before anything is written beneath it.
 */
export function ensureDirectories(path: string, boundary: string, sys: FsSyscalls): EnsureDirectoriesResult {
  const parts = componentsBelow(boundary, dirname(path))
  if (parts === null) {
    return { ok: false, inspection: { reason: 'parent-unusable', path, component: dirname(path) } }
  }

  const created: CreatedDirectory[] = []
  // The boundary itself may not exist yet: a tool's configuration directory is
  // created by the first install that puts something in it. It is the
  // OUTERMOST directory this operation may create — its own parent must
  // already be there, which is what stops a boundary typo from materializing a
  // whole tree of empty directories.
  for (const directory of [boundary, ...cumulativePaths(boundary, parts)]) {
    const outcome = ensureOne(directory, boundary, path, sys)
    if (!outcome.ok) return outcome
    if (outcome.created !== null) created.push(outcome.created)
  }
  return { ok: true, created }
}

/** Each successive directory from `boundary` down to the target's parent. */
function cumulativePaths(boundary: string, parts: readonly string[]): string[] {
  const paths: string[] = []
  let current = boundary
  for (const part of parts) {
    current = `${current}${sep}${part}`
    paths.push(current)
  }
  return paths
}

type EnsureOneResult =
  | { ok: true; created: CreatedDirectory | null }
  | { ok: false; failure: FileOperationFailure }
  | { ok: false; inspection: InspectFileFailure }

function ensureOne(directory: string, boundary: string, path: string, sys: FsSyscalls): EnsureOneResult {
  let stats: ReturnType<FsSyscalls['lstat']> | null = null
  try {
    stats = sys.lstat(directory)
  } catch (error) {
    if (!isNotFound(error)) {
      if (errorCode(error) === 'ENOTDIR') {
        return { ok: false, inspection: { reason: 'parent-unusable', path, component: directory } }
      }
      return {
        ok: false,
        inspection: { reason: 'unreadable', path, code: errorCode(error), message: errorMessage(error) },
      }
    }
  }

  if (stats !== null) {
    // A symlinked BOUNDARY is legitimate — a user may keep a tool's
    // configuration directory in a dotfiles repository — so only components
    // strictly below it are refused.
    if (stats.isSymbolicLink() && directory !== boundary) {
      return { ok: false, inspection: { reason: 'symlinked-ancestor', path, component: directory } }
    }
    if (!stats.isDirectory() && !stats.isSymbolicLink()) {
      return { ok: false, inspection: { reason: 'parent-unusable', path, component: directory } }
    }
    return { ok: true, created: null }
  }

  try {
    sys.mkdir(directory)
  } catch (error) {
    // Something else created it first. It is then not ours to remove, which
    // is exactly what not recording it expresses.
    if (errorCode(error) === 'EEXIST') return { ok: true, created: null }
    return { ok: false, failure: operationFailure('create-directory', directory, error) }
  }

  try {
    const madeStats = sys.lstat(directory)
    return { ok: true, created: { path: directory, boundary, dev: madeStats.dev, ino: madeStats.ino } }
  } catch {
    // We made it but cannot identify it, so we can never prove it is ours
    // later. Leaving it behind is the conservative outcome.
    return { ok: true, created: null }
  }
}

/**
 * Remove directories a delete just emptied, walking up towards `boundary`.
 *
 * Distinct from {@link pruneCreatedDirectories} and deliberately less strict:
 * this runs after a *successful* removal, where the directory is empty
 * precisely because the file this operation owned was the last thing in it.
 * Provenance is not the question — the question is whether anything is left.
 *
 * `rmdir` is non-recursive, which is what makes that safe: a directory holding
 * anything at all, ours or a user's, refuses to be removed and stops the walk.
 * The boundary is never removed and never climbed past.
 */
export function pruneEmptiedAncestors(startDir: string, boundary: string, sys: FsSyscalls): readonly string[] {
  const removed: string[] = []
  let current = startDir
  // Bounded by construction: each step moves strictly closer to the boundary,
  // and the containment check stops the walk if it ever does not.
  while (current !== boundary && componentsBelow(boundary, current) !== null && current !== dirname(current)) {
    try {
      sys.rmdir(current)
      removed.push(current)
    } catch {
      return removed
    }
    current = dirname(current)
  }
  return removed
}

/**
 * Remove directories this transaction created, deepest first.
 *
 * Every guard here fails towards leaving a directory in place:
 *
 *   - identity must still match, so a recreated directory is left alone;
 *   - `rmdir` is non-recursive, so any file inside — ours or not — stops it;
 *   - any error ends that path's attempt without failing the rollback.
 *
 * A directory that existed before this run is never a candidate, because it
 * was never recorded. Emptiness alone is not evidence of ownership.
 */
export function pruneCreatedDirectories(created: readonly CreatedDirectory[], sys: FsSyscalls): readonly string[] {
  const deepestFirst = [...created].sort((a, b) => b.path.length - a.path.length)
  const removed: string[] = []
  for (const directory of deepestFirst) {
    let stats: ReturnType<FsSyscalls['lstat']>
    try {
      stats = sys.lstat(directory.path)
    } catch {
      continue
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) continue
    if (stats.dev !== directory.dev || stats.ino !== directory.ino) continue
    try {
      sys.rmdir(directory.path)
      removed.push(directory.path)
    } catch {
      // Not empty, not permitted, already gone — all mean "leave it".
    }
  }
  return removed
}
