import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  assembleAssetContent,
  errorMessage,
  isMissingFileError,
  pruneEmptyParents,
  splitAssetContent,
  validateContainedRelativePath,
} from './asset-fs.ts'
import type {
  AdapterAssetFailure,
  CompanionMap,
  DeleteAssetResult,
  InstallAssetResult,
  ReadAssetResult,
} from './types.ts'

/**
 * Atomic skill-bundle helpers for adapter implementations.
 *
 * A skill is a multi-file bundle: one primary file (`SKILL.md`, subject to
 * front-matter/metadata transformation) plus zero or more companion files
 * (opaque bytes, stored verbatim) below the skill root. These helpers
 * centralize the security-sensitive machinery — companion-path containment,
 * snapshot/rollback staging, ownership-set-based deletion, and
 * empty-directory pruning — so adapters built on them inherit correct
 * behavior.
 *
 * Atomicity model: every mutation snapshots the prior state of each file
 * it will touch; a handled failure mid-operation rolls the touched files
 * back, leaving the prior bundle intact. This covers handled failures
 * within one operation — it is not a durable write-ahead log. Recovery
 * from a process crash is the caller's idempotent re-install.
 *
 * Ownership is caller-supplied per operation. These helpers never
 * enumerate the skill directory and never touch a path that isn't the
 * primary file, a new-bundle companion, or a member of the supplied
 * owned-path set — so unowned files can never be read, deleted, or
 * swept into results.
 */

/** Filesystem locations for one skill bundle. */
export interface SkillBundlePaths {
  /** Absolute path of the skill root directory (e.g. `<base>/skills/<name>`). */
  readonly root: string
  /** Absolute path of the primary file (e.g. `<root>/SKILL.md`). Must be inside `root`. */
  readonly primaryFile: string
  /**
   * Absolute path of the adapter-controlled base directory. Directories
   * left empty by owned-file removal are pruned upward, stopping before
   * this boundary. When absent, pruning stops at (and includes nothing
   * above) the skill root's parent.
   */
  readonly pruneBoundary?: string
}

/**
 * True when `abs` is a strict descendant of `root` (not equal, not outside),
 * using the platform path separator. On Windows `root`/`abs` are
 * backslash-separated, so a hardcoded `/` boundary check would reject every
 * legitimate companion; `relative`/`isAbsolute` are separator-agnostic.
 */
function isStrictlyBelow(abs: string, root: string): boolean {
  const rel = relative(root, abs)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * A portable collision key for a companion path: NFC-normalized and
 * case-folded so paths that are distinct byte sequences but resolve to the
 * same file on a case-insensitive (Windows, default macOS) volume are
 * detected as duplicates before any write silently overwrites the other.
 */
function companionCollisionKey(relPath: string): string {
  return relPath.normalize('NFC').toLowerCase()
}

/**
 * Validate every supplied companion path (new-bundle keys and owned paths)
 * and resolve them below the skill root — before any mutating filesystem
 * access. Enforces, in order:
 *
 *  - the resolved primary is a strict descendant of the skill root (a public
 *    SDK caller could otherwise point `primaryFile` at an external file);
 *  - each companion is textually relative/canonical/contained;
 *  - the primary filename (`SKILL.md`) is never a companion — it would
 *    overwrite the assembled primary or delete it as "stale";
 *  - no two companions collide by portable case-fold/NFC form;
 *  - the resolved companion is a strict descendant of the root (defense in
 *    depth against a textual-validator bug);
 *  - no already-existing parent directory of a companion is a symlink, so a
 *    later `mkdir`/`writeFile` cannot follow a link outside the root.
 *
 * Returns a failure on the first violation without reading, writing, or
 * deleting anything mutating (symlink checks are read-only `lstat`s).
 */
async function resolveCompanionPaths(
  paths: SkillBundlePaths,
  supplied: Iterable<string>,
): Promise<{ ok: true; resolved: Map<string, string> } | { ok: false; failure: AdapterAssetFailure }> {
  const root = resolve(paths.root)

  // The primary file itself must live below the skill root.
  const primaryAbs = resolve(paths.primaryFile)
  if (!isStrictlyBelow(primaryAbs, root)) {
    return {
      ok: false,
      failure: {
        code: 'invalid-companion-path',
        path: paths.primaryFile,
        reason: 'primary file escapes the skill root',
      },
    }
  }
  const primaryName = basename(primaryAbs)

  const resolvedMap = new Map<string, string>()
  const seenKeys = new Map<string, string>()
  for (const relPath of supplied) {
    const check = validateContainedRelativePath(relPath)
    if (!check.ok) {
      return { ok: false, failure: { code: 'invalid-companion-path', path: relPath, reason: check.reason } }
    }

    const abs = resolve(join(root, relPath))

    // A companion may not target the primary file itself. Otherwise the write
    // loop overwrites the assembled primary with opaque bytes, or the
    // stale-owned sweep deletes a primary that was just written. A companion
    // named SKILL.md in a sub-directory (references/SKILL.md) is fine — it
    // resolves to a different path than the primary.
    if (abs === primaryAbs) {
      return {
        ok: false,
        failure: {
          code: 'invalid-companion-path',
          path: relPath,
          reason: `companion path collides with the primary file "${primaryName}"`,
        },
      }
    }

    // Defense-in-depth: the textual validation above already guarantees
    // containment; this re-checks the resolved form so a validator bug
    // can't silently become a traversal.
    if (!isStrictlyBelow(abs, root)) {
      return {
        ok: false,
        failure: { code: 'invalid-companion-path', path: relPath, reason: 'path escapes the skill root' },
      }
    }

    // Portable case-fold / NFC duplicate detection: two spellings that map to
    // one file on a case-insensitive volume would silently overwrite.
    const key = companionCollisionKey(relPath)
    const clash = seenKeys.get(key)
    if (clash !== undefined && clash !== relPath) {
      return {
        ok: false,
        failure: {
          code: 'invalid-companion-path',
          path: relPath,
          reason: `collides with "${clash}" by case folding or Unicode normalization`,
        },
      }
    }
    seenKeys.set(key, relPath)

    // Reject symlinked existing parents: a lexically valid companion under a
    // symlinked directory (references -> /elsewhere) would let a later write
    // escape the root. Walk the existing parent chain and reject any symlink.
    const parentIssue = await rejectSymlinkedParents(abs, root)
    if (parentIssue !== undefined) {
      return { ok: false, failure: { code: 'invalid-companion-path', path: relPath, reason: parentIssue } }
    }

    resolvedMap.set(relPath, abs)
  }
  return { ok: true, resolved: resolvedMap }
}

/**
 * Walk from `abs`'s parent up to (but not including) `root`, rejecting any
 * intermediate component that exists and is itself a symlink — the escape
 * vector where a directory *inside* the skill root (e.g. `references ->
 * /elsewhere`) would let a later `mkdir`/`writeFile` land outside the root.
 *
 * Non-existent parents are fine — `mkdir` will create them inside the root.
 * The skill root itself and its ancestors are deliberately not checked: the
 * root may legitimately sit under a symlinked ancestor (e.g. macOS `/var ->
 * /private/var`), and that says nothing about companion containment. Purely
 * read-only (`lstat`, which does not follow links).
 */
async function rejectSymlinkedParents(abs: string, root: string): Promise<string | undefined> {
  let current = dirname(abs)
  const chain: string[] = []
  while (current !== root && isStrictlyBelow(current, root)) {
    chain.push(current)
    current = dirname(current)
  }
  for (const dir of chain) {
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(dir)
    } catch {
      // Does not exist yet — safe, mkdir will create it inside the root.
      continue
    }
    if (info.isSymbolicLink()) {
      return `parent directory "${dir}" is a symbolic link`
    }
  }
  return undefined
}

/** Prior state of one file: exact bytes, or null when it did not exist. */
type Snapshot = Map<string, Uint8Array | null>

async function snapshotFile(snapshot: Snapshot, absPath: string): Promise<void> {
  if (snapshot.has(absPath)) return
  try {
    snapshot.set(absPath, new Uint8Array(await readFile(absPath)))
  } catch (err) {
    if (isMissingFileError(err)) {
      snapshot.set(absPath, null)
      return
    }
    throw err
  }
}

/**
 * Best-effort restore of every snapshotted file: previously-existing files
 * get their exact prior bytes back; files that did not exist are removed.
 * Returns the first restore error, if any.
 */
async function restoreSnapshot(snapshot: Snapshot): Promise<{ path: string; message: string } | undefined> {
  let firstError: { path: string; message: string } | undefined
  for (const [absPath, prior] of snapshot) {
    try {
      if (prior === null) {
        await rm(absPath, { force: true })
      } else {
        await mkdir(dirname(absPath), { recursive: true })
        await writeFile(absPath, prior)
      }
    } catch (err) {
      firstError ??= { path: absPath, message: errorMessage(err) }
    }
  }
  return firstError
}

function ioFailure(operation: 'read' | 'write' | 'delete', path: string, err: unknown): AdapterAssetFailure {
  return { code: 'io-failed', operation, path, message: errorMessage(err) }
}

function rollbackFailure(inner: { path: string; message: string }): AdapterAssetFailure {
  return { code: 'io-failed', operation: 'rollback', path: inner.path, message: inner.message }
}

/**
 * Install (or replace) a complete skill bundle atomically.
 *
 * Writes the primary (with front-matter assembly — the only file metadata
 * transformation applies to) and every companion verbatim, then removes
 * previously-owned companion paths absent from the new bundle. On any
 * handled failure the prior state of every touched file is restored, so
 * no partial bundle is left behind. Empty directories left by stale-owned
 * removal are pruned.
 */
export async function installSkillBundle(
  paths: SkillBundlePaths,
  options: {
    readonly content: string
    readonly metadata?: Record<string, unknown>
    readonly companions: CompanionMap
    readonly ownedCompanionPaths: readonly string[]
  },
): Promise<InstallAssetResult> {
  const newPaths = Object.keys(options.companions)
  const validated = await resolveCompanionPaths(paths, new Set([...newPaths, ...options.ownedCompanionPaths]))
  if (!validated.ok) return { ok: false, failure: validated.failure }
  const { resolved } = validated

  const newSet = new Set(newPaths)
  const staleOwned = options.ownedCompanionPaths.filter((p) => !newSet.has(p))

  const snapshot: Snapshot = new Map()
  // Track the path being read so a snapshot failure names the real file,
  // not always the primary.
  let currentPath = paths.primaryFile
  try {
    // Snapshot everything we will touch before mutating anything.
    await snapshotFile(snapshot, paths.primaryFile)
    for (const relPath of newPaths) {
      // biome-ignore lint/style/noNonNullAssertion: resolved contains every validated path
      currentPath = resolved.get(relPath)!
      await snapshotFile(snapshot, currentPath)
    }
    for (const relPath of staleOwned) {
      // biome-ignore lint/style/noNonNullAssertion: resolved contains every validated path
      currentPath = resolved.get(relPath)!
      await snapshotFile(snapshot, currentPath)
    }
  } catch (err) {
    return { ok: false, failure: ioFailure('read', currentPath, err) }
  }

  // Mutate: primary, companions, stale-owned removal.
  currentPath = paths.primaryFile
  try {
    await mkdir(dirname(paths.primaryFile), { recursive: true })
    await writeFile(paths.primaryFile, assembleAssetContent(options.content, options.metadata), 'utf8')
    for (const [relPath, bytes] of Object.entries(options.companions)) {
      // biome-ignore lint/style/noNonNullAssertion: resolved contains every validated path
      const abs = resolved.get(relPath)!
      currentPath = abs
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, bytes)
    }
  } catch (err) {
    const failure = ioFailure('write', currentPath, err)
    const restoreError = await restoreSnapshot(snapshot)
    return { ok: false, failure: restoreError ? rollbackFailure(restoreError) : failure }
  }

  const deletedDirs: string[] = []
  try {
    for (const relPath of staleOwned) {
      // biome-ignore lint/style/noNonNullAssertion: resolved contains every validated path
      const abs = resolved.get(relPath)!
      currentPath = abs
      await rm(abs, { force: true })
      deletedDirs.push(dirname(abs))
    }
  } catch (err) {
    const failure = ioFailure('delete', currentPath, err)
    const restoreError = await restoreSnapshot(snapshot)
    return { ok: false, failure: restoreError ? rollbackFailure(restoreError) : failure }
  }

  await pruneDirs(deletedDirs, paths)
  return { ok: true, primaryPath: paths.primaryFile }
}

/**
 * Read a skill bundle: canonical primary content (storage encoding
 * stripped via front-matter split) plus the bytes of exactly the
 * requested owned companion paths that exist on disk. Owned paths absent
 * from disk are simply omitted from the returned map — that omission is
 * the caller's drift signal. Never enumerates the skill directory.
 */
export async function readSkillBundle(
  paths: SkillBundlePaths,
  ownedCompanionPaths: readonly string[],
): Promise<ReadAssetResult> {
  const validated = await resolveCompanionPaths(paths, ownedCompanionPaths)
  if (!validated.ok) return { ok: false, failure: validated.failure }

  let raw: string
  try {
    raw = await readFile(paths.primaryFile, 'utf8')
  } catch (err) {
    if (isMissingFileError(err)) return { ok: false, failure: { code: 'not-found' } }
    return { ok: false, failure: ioFailure('read', paths.primaryFile, err) }
  }
  const { content, metadata } = splitAssetContent(raw)

  // Prototype-free map: an owned companion legitimately named `__proto__`
  // (or `constructor`, etc.) must become a real entry, not invoke an
  // inherited setter and vanish from the result — which a reconciliation
  // pass would then read as missing.
  const companions: Record<string, Uint8Array> = Object.create(null)
  for (const [relPath, abs] of validated.resolved) {
    try {
      companions[relPath] = new Uint8Array(await readFile(abs))
    } catch (err) {
      if (isMissingFileError(err)) continue
      return { ok: false, failure: ioFailure('read', abs, err) }
    }
  }

  return { ok: true, asset: { assetType: 'skill', content, metadata, companions } }
}

/**
 * Delete a skill bundle atomically: the primary file plus exactly the
 * supplied owned companion paths. Every other file is preserved, and only
 * directories left empty by owned-file removal are pruned. On a handled
 * failure mid-deletion the already-removed files are restored from their
 * snapshots, so the prior bundle remains available.
 */
export async function deleteSkillBundle(
  paths: SkillBundlePaths,
  ownedCompanionPaths: readonly string[],
): Promise<DeleteAssetResult> {
  const validated = await resolveCompanionPaths(paths, ownedCompanionPaths)
  if (!validated.ok) return { ok: false, failure: validated.failure }

  const targets: string[] = [paths.primaryFile, ...validated.resolved.values()]

  // Track the exact path being touched so a failure attributes the error to
  // the real file — a companion, not always the primary.
  let currentPath = paths.primaryFile
  const snapshot: Snapshot = new Map()
  try {
    for (const abs of targets) {
      currentPath = abs
      await snapshotFile(snapshot, abs)
    }
  } catch (err) {
    return { ok: false, failure: ioFailure('read', currentPath, err) }
  }

  const existed = [...snapshot.values()].some((bytes) => bytes !== null)

  const deletedPaths: string[] = []
  const deletedDirs: string[] = []
  try {
    for (const abs of targets) {
      if (snapshot.get(abs) === null) continue
      currentPath = abs
      await rm(abs, { force: true })
      deletedPaths.push(abs)
      deletedDirs.push(dirname(abs))
    }
  } catch (err) {
    const failure = ioFailure('delete', currentPath, err)
    const restoreError = await restoreSnapshot(snapshot)
    return { ok: false, failure: restoreError ? rollbackFailure(restoreError) : failure }
  }

  await pruneDirs(deletedDirs, paths)
  return { ok: true, existed, deletedPaths }
}

/**
 * Prune empty directories upward from each deletion site. The boundary is
 * `pruneBoundary` when supplied (so the skill root itself can be removed
 * once emptied), otherwise the skill root's parent.
 */
async function pruneDirs(startDirs: readonly string[], paths: SkillBundlePaths): Promise<void> {
  const boundary = paths.pruneBoundary ?? dirname(resolve(paths.root))
  for (const dir of new Set(startDirs)) {
    await pruneEmptyParents(dir, boundary)
  }
}
