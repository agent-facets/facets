import { dirname, relative, sep } from 'node:path'
import { errorCode, errorMessage, type InspectFileFailure, isNotFound } from '@agent-facets/common'
import { type FileOperationFailure, type FsSyscalls, operationFailure } from './syscalls.ts'

/**
 * Directories are tracked separately from files, and answer a different
 * question than files do.
 *
 * The journal is file-oriented: a directory is not a state a plan targets, it
 * is a thing that had to exist so a file could. Cleanup therefore asks whether
 * anything is left inside a managed directory, not who created it. Identity is
 * deliberately NOT tracked: `(dev, ino)` and creation time are all reusable —
 * Linux recycles an inode the moment it is freed — so a token built from them
 * proves nothing a later `rmdir` does not already establish.
 *
 * `rmdir` is the whole mechanism. It is non-recursive, so the filesystem
 * decides emptiness and performs the removal in one step: a directory holding
 * anything at all, ours or a user's, refuses to be removed. That leaves no
 * check-then-delete window for a concurrent write to slip through, and it is
 * the same guarantee on Linux, macOS, and Windows.
 *
 * The boundary is what bounds the blast radius: a tool's configuration
 * directory (`.claude`, `.opencode`) is never removed and never climbed past,
 * so cleanup can only ever reclaim the tree this operation materialized.
 */

/** A directory this transaction created, and the boundary it may not pass. */
export interface CreatedDirectory {
  readonly path: string
  readonly boundary: string
}

/**
 * The outcome of creating the directories a path needs.
 *
 * Every arm carries `created`, the failing ones included: a walk refused at
 * its third component still made the first two, and nothing but its caller
 * will ever be in a position to remove them.
 */
export type EnsureDirectoriesResult =
  | { ok: true; created: readonly CreatedDirectory[] }
  | { ok: false; reason: 'operation'; created: readonly CreatedDirectory[]; failure: FileOperationFailure }
  | { ok: false; reason: 'inspection'; created: readonly CreatedDirectory[]; failure: InspectFileFailure }

/** The components strictly between `boundary` and `target`, outermost first. */
function componentsBelow(boundary: string, target: string): string[] | null {
  const rel = relative(boundary, target)
  if (rel === '') return []
  if (rel.startsWith('..') || rel.startsWith(`${sep}..`)) return null
  return rel.split(sep).filter((part) => part.length > 0)
}

/**
 * What one path component is, as far as descending through it is concerned.
 *
 * `absent` is its own answer rather than a rejection because callers read it
 * differently: an ancestor walk takes it as "the write will create the rest",
 * directory creation as "make it".
 */
type ComponentInspection = { kind: 'usable' } | { kind: 'absent' } | { kind: 'rejected'; failure: InspectFileFailure }

/**
 * Decide whether one component may be descended through.
 *
 * One definition because the question is asked at three moments — walking
 * ancestors, before creating a directory, and after losing the race to create
 * one — and the third had no copy of the rule at all.
 *
 * `path` is the mutation's target, which failures are reported against;
 * `component` is the ancestor being judged.
 */
function classifyComponent(component: string, path: string, isBoundary: boolean, sys: FsSyscalls): ComponentInspection {
  let stats: ReturnType<FsSyscalls['lstat']>
  try {
    stats = sys.lstat(component)
  } catch (error) {
    if (isNotFound(error)) return { kind: 'absent' }
    if (errorCode(error) === 'ENOTDIR') {
      return { kind: 'rejected', failure: { reason: 'parent-unusable', path, component } }
    }
    return {
      kind: 'rejected',
      failure: { reason: 'unreadable', path, code: errorCode(error), message: errorMessage(error) },
    }
  }

  if (stats.isSymbolicLink()) {
    // A symlinked BOUNDARY is legitimate — a user may keep a tool's
    // configuration directory in a dotfiles repository — so only components
    // strictly below it are refused.
    if (!isBoundary) return { kind: 'rejected', failure: { reason: 'symlinked-ancestor', path, component } }
    return boundaryLinkTarget(component, path, sys)
  }
  if (!stats.isDirectory()) return { kind: 'rejected', failure: { reason: 'parent-unusable', path, component } }
  return { kind: 'usable' }
}

/**
 * Confirm that a symlinked boundary actually reaches a directory.
 *
 * Permitting the link is not the same as assuming what is on the other end.
 * The batch preflight follows the boundary once, before any mutation, so a
 * boundary that becomes a link to a file — or to nothing — after that would
 * otherwise surface as a staging errno naming no component at all.
 */
function boundaryLinkTarget(component: string, path: string, sys: FsSyscalls): ComponentInspection {
  try {
    if (!sys.statFollowing(component).isDirectory()) {
      return { kind: 'rejected', failure: { reason: 'parent-unusable', path, component } }
    }
    return { kind: 'usable' }
  } catch (error) {
    // A dangling link is not an absent boundary: the name is taken, and
    // creating through it would write wherever it points.
    if (isNotFound(error)) {
      return { kind: 'rejected', failure: { reason: 'parent-unusable', path, component } }
    }
    return {
      kind: 'rejected',
      failure: { reason: 'unreadable', path, code: errorCode(error), message: errorMessage(error) },
    }
  }
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
    // Every component here is strictly below the boundary, so none of them is
    // the boundary's own permitted symlink.
    const inspected = classifyComponent(current, path, false, sys)
    // Missing here means missing all the way down; the write will create it.
    if (inspected.kind === 'absent') return { ok: true }
    if (inspected.kind === 'rejected') return { ok: false, failure: inspected.failure }
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
  const created: CreatedDirectory[] = []
  const parts = componentsBelow(boundary, dirname(path))
  if (parts === null) {
    return {
      ok: false,
      reason: 'inspection',
      created,
      failure: { reason: 'parent-unusable', path, component: dirname(path) },
    }
  }

  // The boundary itself may not exist yet: a tool's configuration directory is
  // created by the first install that puts something in it. It is the
  // OUTERMOST directory this operation may create — its own parent must
  // already be there, which is what stops a boundary typo from materializing a
  // whole tree of empty directories.
  for (const directory of [boundary, ...cumulativePaths(boundary, parts)]) {
    const outcome = ensureOne(directory, boundary, path, sys)
    if (!outcome.ok) {
      return outcome.reason === 'operation'
        ? { ok: false, reason: 'operation', created, failure: outcome.failure }
        : { ok: false, reason: 'inspection', created, failure: outcome.failure }
    }
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
  | { ok: false; reason: 'operation'; failure: FileOperationFailure }
  | { ok: false; reason: 'inspection'; failure: InspectFileFailure }

/**
 * How many times a name that keeps appearing and vanishing may send this walk
 * round again.
 *
 * One retry settles ordinary contention — two installs racing, an editor's
 * temporary churn. The bound is what keeps the same situation from becoming a
 * livelock anything could hold open indefinitely.
 */
const MKDIR_ATTEMPTS = 2

function ensureOne(directory: string, boundary: string, path: string, sys: FsSyscalls): EnsureOneResult {
  const isBoundary = directory === boundary

  for (let attempt = 0; attempt < MKDIR_ATTEMPTS; attempt++) {
    const inspected = classifyComponent(directory, path, isBoundary, sys)
    if (inspected.kind === 'rejected') return { ok: false, reason: 'inspection', failure: inspected.failure }
    // Already there and usable. It is then not ours to remove, which is
    // exactly what not recording it expresses.
    if (inspected.kind === 'usable') return { ok: true, created: null }

    try {
      sys.mkdir(directory)
    } catch (error) {
      // EEXIST says the NAME is taken, not that a directory is there: mkdir
      // reports it just as readily for a symlink or a plain file that
      // appeared in the window this call lost. Descending on the errno alone
      // follows whatever arrived, and a symlink redirects every write beneath
      // it out of the boundary — so ask again what is actually at the path.
      if (errorCode(error) === 'EEXIST') continue
      return { ok: false, reason: 'operation', failure: operationFailure('create-directory', directory, error) }
    }

    return { ok: true, created: { path: directory, boundary } }
  }

  return {
    ok: false,
    reason: 'operation',
    failure: {
      operation: 'create-directory',
      path: directory,
      code: 'EEXIST',
      message: 'the path kept being created and removed by something else while this operation ran',
    },
  }
}

/**
 * Remove directories a delete just emptied, walking up towards `boundary`.
 *
 * Runs after a file this operation managed is gone, so a directory that is now
 * empty is empty *because* of this operation. Provenance is not the question —
 * the question is whether anything is left.
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
 * Deepest first so a parent is only considered once its children have had
 * their turn: removing `skills/planning/` is what makes `skills/` empty.
 *
 * `rmdir` alone decides. A directory holding anything — a user's file, another
 * facet's asset, a child directory that refused to go — fails the call and is
 * left exactly as it was. Any other error means the same thing: leave it.
 *
 * A boundary this transaction created IS a candidate, unlike in
 * {@link pruneEmptiedAncestors}. The difference is what the two functions are
 * handed: everything here was made by this run, so removing an empty one puts
 * the tree back the way it was found. The ancestor walk climbs through
 * directories nobody recorded, which is why it stops at the boundary instead.
 */
export function pruneCreatedDirectories(created: readonly CreatedDirectory[], sys: FsSyscalls): readonly string[] {
  const deepestFirst = [...created].sort((a, b) => b.path.length - a.path.length)
  const removed: string[] = []
  for (const directory of deepestFirst) {
    try {
      sys.rmdir(directory.path)
      removed.push(directory.path)
    } catch {
      // Not empty, not permitted, already gone — all mean "leave it".
    }
  }
  return removed
}
