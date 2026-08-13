import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  ABSENT_FILE,
  errorCode,
  FILE_MODE_MASK,
  type FileMutation,
  type FileMutationAction,
  type FileState,
  fileStatesEqual,
  type InspectFileFailure,
  inspectFileState,
  isNonEmpty,
  isNoOpMutation,
  type NonEmptyArray,
  regularFile,
} from '@agent-facets/common'
import {
  type CreatedDirectory,
  ensureDirectories,
  inspectAncestors,
  pruneCreatedDirectories,
  pruneEmptiedAncestors,
} from './directories.ts'
import {
  DEFAULT_NEW_FILE_MODE,
  type FileOperationFailure,
  type FsSyscalls,
  nodeFsSyscalls,
  operationFailure,
} from './syscalls.ts'

/**
 * The generic filesystem transaction.
 *
 * It understands files and nothing else — not assets, not MCP servers, not
 * manifests, not adapters. A caller hands it a batch of exact per-file state
 * transitions; it performs them or refuses, and remembers precisely what it
 * changed so a later failure can put those files back.
 *
 * Four rules do the work:
 *
 *   1. **Only real mutation targets are journaled.** A file that was merely
 *      read to compute a change never enters the ledger, so a rollback can
 *      never overwrite someone else's edit to a file this run did not write.
 *   2. **Both endpoints are recorded.** An entry is `A → B`: A is where to
 *      restore to, B is exactly what this run left behind. Rollback compares
 *      against B, so "the file differs from A" is no longer mistaken for "we
 *      changed it".
 *   3. **Recovery is armed before the syscall, not after.** A rename can land
 *      and then fail to report success; a transition recorded afterwards would
 *      miss it.
 *   4. **A batch commits or leaves nothing behind.** Each logical operation's
 *      mutations are applied against a savepoint, and only a complete batch is
 *      merged into the durable journal.
 *
 * Crash-restart recovery is deliberately out of scope: the journal lives in
 * memory, and recovery from a killed process remains an idempotent re-run.
 */

/** One durable `A → B` transition this transaction performed. */
export interface FileTransition {
  readonly path: string
  readonly boundary: string
  readonly original: FileState
  readonly committed: FileState
}

/** A batch that could not be accepted, before anything was inspected. */
export type ValidateBatchFailure =
  | { readonly reason: 'invalid-path'; readonly path: string; readonly detail: string }
  | { readonly reason: 'invalid-boundary'; readonly path: string; readonly boundary: string; readonly detail: string }
  | { readonly reason: 'escapes-boundary'; readonly path: string; readonly boundary: string }
  | {
      readonly reason: 'duplicate-path'
      readonly path: string
      readonly collidesWith: string
      readonly by: 'exact' | 'case-fold'
    }

/** A problem found while checking the whole batch, before any mutation ran. */
export type PreflightIssue =
  | { readonly kind: 'inspect-failed'; readonly path: string; readonly failure: InspectFileFailure }
  | { readonly kind: 'drift'; readonly path: string; readonly expected: FileState; readonly observed: FileState }

/**
 * Why a batch did not complete.
 *
 * `preflight` and `conflict` describe the same fact — a file is not in the
 * state the plan was computed from — but they are separate arms because their
 * consequences differ: a preflight rejection happened before anything was
 * armed, while a conflict happened mid-batch and was followed by a savepoint
 * rollback. A caller reporting disk state must not confuse them.
 */
export type FileTransactionFailure =
  | { readonly kind: 'invalid-batch'; readonly failures: NonEmptyArray<ValidateBatchFailure> }
  | { readonly kind: 'preflight'; readonly issues: NonEmptyArray<PreflightIssue> }
  | { readonly kind: 'inspect-failed'; readonly path: string; readonly failure: InspectFileFailure }
  | { readonly kind: 'conflict'; readonly path: string; readonly expected: FileState; readonly observed: FileState }
  | {
      readonly kind: 'verify-mismatch'
      readonly path: string
      readonly intended: FileState
      readonly observed: FileState
    }
  | { readonly kind: 'operation'; readonly failure: FileOperationFailure }

/** Failures reachable before anything was armed — no rollback exists. */
export type RefusedFailure = Extract<FileTransactionFailure, { kind: 'invalid-batch' | 'preflight' }>

/** Failures reachable once a mutation may have landed. */
export type AbortedFailure = Exclude<FileTransactionFailure, RefusedFailure>

/**
 * One transition that could not be put back.
 *
 * `conflict` is not a failure of this system: it means the file no longer
 * holds what this run wrote, so something else owns those bytes now and they
 * were left alone deliberately. Reporting it as a rollback error would send a
 * user hunting for a bug in the operation that protected their edit.
 */
export type FileRollbackIssue =
  | {
      readonly kind: 'conflict'
      readonly path: string
      readonly original: FileState
      readonly committed: FileState
      readonly observed: FileState
    }
  | {
      readonly kind: 'inspect-failed'
      readonly path: string
      readonly original: FileState
      readonly committed: FileState
      readonly failure: InspectFileFailure
    }
  | {
      readonly kind: 'restore-failed'
      readonly path: string
      readonly original: FileState
      readonly committed: FileState
      readonly failure: FileOperationFailure
    }

/**
 * What a rollback achieved.
 *
 * `incomplete` carries a non-empty issue list by type, so the arm that means
 * "something is still out there" cannot be constructed with nothing out there.
 */
export type FileRollbackOutcome =
  | {
      readonly kind: 'complete'
      readonly restored: readonly string[]
      readonly alreadyRestored: readonly string[]
      readonly removedDirectories: readonly string[]
    }
  | {
      readonly kind: 'incomplete'
      readonly restored: readonly string[]
      readonly alreadyRestored: readonly string[]
      readonly removedDirectories: readonly string[]
      readonly issues: NonEmptyArray<FileRollbackIssue>
    }

export type ApplyBatchResult =
  | { readonly ok: true; readonly applied: readonly string[]; readonly skipped: readonly string[] }
  | { readonly ok: false; readonly stage: 'refused'; readonly failure: RefusedFailure }
  | {
      readonly ok: false
      readonly stage: 'aborted'
      readonly failure: AbortedFailure
      readonly rollback: FileRollbackOutcome
    }

/**
 * Deterministic interleaving points, for tests only.
 *
 * Production passes {@link NO_HOOKS}. These exist because the transaction's
 * hardest guarantees are about what happens *between* two syscalls, and no
 * amount of real-filesystem setup can place a concurrent write there.
 */
export interface FileTransactionHooks {
  readonly afterPreflight?: (paths: readonly string[]) => void
  readonly beforeMutation?: (path: string) => void
  readonly afterCommit?: (path: string) => void
  readonly beforeRollback?: () => void
}

export const NO_HOOKS: FileTransactionHooks = {}

/** What a batch did to one path, retained until the batch commits or unwinds. */
interface SavepointEntry {
  readonly path: string
  readonly boundary: string
  /** The state immediately before this batch touched the path. */
  readonly before: FileState
  /**
   * The state this batch is responsible for. Before the syscall it is the
   * intended state; after verification it is the observed one. Both are
   * legitimately ours while the syscall's outcome is unknown, which is what
   * makes arming early sound rather than merely early.
   */
  readonly latest: FileState
}

interface JournalEntry {
  readonly path: string
  readonly boundary: string
  /** Never reassigned: the first original is the restoration point forever. */
  readonly original: FileState
  committed: FileState
  readonly order: number
}

type ApplyOneResult = { ok: true } | { ok: false; failure: AbortedFailure }

/** NFC + case fold, for detecting two spellings of one file on a folding volume. */
function foldKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

export class FileTransaction {
  private readonly transitions = new Map<string, JournalEntry>()
  private readonly createdDirectories: CreatedDirectory[] = []
  private order = 0
  private stageCounter = 0

  constructor(
    private readonly sys: FsSyscalls = nodeFsSyscalls,
    private readonly hooks: FileTransactionHooks = NO_HOOKS,
  ) {}

  /** Whether anything is journaled — i.e. whether a rollback would do work. */
  hasMutations(): boolean {
    return this.transitions.size > 0
  }

  /** The durable transitions, oldest first. Diagnostics and tests only. */
  journal(): readonly FileTransition[] {
    return [...this.transitions.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ path, boundary, original, committed }) => ({ path, boundary, original, committed }))
  }

  /** Directories created and still attributable to this transaction. */
  createdDirectoryPaths(): readonly string[] {
    return this.createdDirectories.map((directory) => directory.path)
  }

  /**
   * Apply one logical operation's mutations as a batch.
   *
   * All-or-nothing at the batch level: if any mutation fails, every mutation
   * this batch already made is returned to its immediate pre-batch state and
   * nothing is merged into the journal. A caller therefore never has to reason
   * about a half-written skill bundle.
   */
  apply(action: FileMutationAction): ApplyBatchResult {
    if (action.kind === 'unchanged') return { ok: true, applied: [], skipped: [] }

    const validated = validateBatch(action.mutations)
    if (!validated.ok) {
      return { ok: false, stage: 'refused', failure: { kind: 'invalid-batch', failures: validated.failures } }
    }
    const { mutations, skipped } = validated
    if (mutations.length === 0) return { ok: true, applied: [], skipped }

    const issues = this.preflight(mutations)
    if (isNonEmpty(issues)) {
      return { ok: false, stage: 'refused', failure: { kind: 'preflight', issues } }
    }
    this.hooks.afterPreflight?.(mutations.map((mutation) => mutation.path))

    const savepoint: SavepointEntry[] = []
    const created: CreatedDirectory[] = []
    for (const mutation of mutations) {
      const result = this.applyOne(mutation, savepoint, created)
      if (!result.ok) {
        const rollback = this.unwind(savepoint, created)
        return { ok: false, stage: 'aborted', failure: result.failure, rollback }
      }
    }

    this.merge(savepoint, created)
    // A directory left empty by a removal is swept now, not at rollback time:
    // the file that was in it is gone for good as far as this batch is
    // concerned, and leaving `skills/<name>/` behind after removing a skill
    // is exactly the litter this cleanup exists to prevent. Non-recursive, so
    // anything else in there — including a file the user put there — stops it.
    for (const mutation of mutations) {
      if (mutation.kind !== 'delete') continue
      pruneEmptiedAncestors(dirname(mutation.path), mutation.boundary, this.sys)
    }
    return { ok: true, applied: mutations.map((mutation) => mutation.path), skipped }
  }

  /**
   * Return every journaled path to its original state.
   *
   * Continues past every problem: one file another process took ownership of
   * must not strand the rest of the operation's changes on disk. The journal
   * is drained, so a second call is a no-op.
   */
  rollback(): FileRollbackOutcome {
    this.hooks.beforeRollback?.()
    const entries = [...this.transitions.values()].sort((a, b) => b.order - a.order)
    const restored: string[] = []
    const alreadyRestored: string[] = []
    const issues: FileRollbackIssue[] = []

    for (const entry of entries) {
      const outcome = this.restore(entry.path, entry.boundary, entry.original, entry.committed)
      switch (outcome.kind) {
        case 'restored':
          restored.push(entry.path)
          break
        case 'already-restored':
          alreadyRestored.push(entry.path)
          break
        case 'issue':
          issues.push(outcome.issue)
          break
      }
    }

    const removedDirectories = pruneCreatedDirectories(this.createdDirectories, this.sys)
    this.transitions.clear()
    this.createdDirectories.length = 0

    if (isNonEmpty(issues)) {
      return { kind: 'incomplete', restored, alreadyRestored, removedDirectories, issues }
    }
    return { kind: 'complete', restored, alreadyRestored, removedDirectories }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private preflight(mutations: readonly FileMutation[]): PreflightIssue[] {
    const issues: PreflightIssue[] = []
    const checkedBoundaries = new Set<string>()

    for (const mutation of mutations) {
      if (!checkedBoundaries.has(mutation.boundary)) {
        checkedBoundaries.add(mutation.boundary)
        // The boundary need not exist — a tool's configuration directory is
        // created by the first install that puts something in it — but if
        // something IS there it has to be a directory. Followed rather than
        // `lstat`'d on purpose: a user may keep that directory as a symlink
        // into a dotfiles repository, and refusing that would reject a
        // legitimate setup while proving nothing about containment.
        try {
          if (!this.sys.statFollowing(mutation.boundary).isDirectory()) {
            issues.push({
              kind: 'inspect-failed',
              path: mutation.path,
              failure: { reason: 'parent-unusable', path: mutation.path, component: mutation.boundary },
            })
            continue
          }
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') {
            issues.push({
              kind: 'inspect-failed',
              path: mutation.path,
              failure: {
                reason: 'unreadable',
                path: mutation.boundary,
                ...(errorCode(error) === undefined ? {} : { code: errorCode(error) }),
                message: `boundary directory is unusable: ${errorCode(error) ?? 'unknown error'}`,
              },
            })
            continue
          }
        }
      }

      const ancestors = inspectAncestors(mutation.path, mutation.boundary, this.sys)
      if (!ancestors.ok) {
        issues.push({ kind: 'inspect-failed', path: mutation.path, failure: ancestors.failure })
        continue
      }
      const inspected = inspectFileState(mutation.path, this.sys)
      if (!inspected.ok) {
        issues.push({ kind: 'inspect-failed', path: mutation.path, failure: inspected.failure })
        continue
      }
      if (!fileStatesEqual(inspected.state, mutation.expected)) {
        issues.push({ kind: 'drift', path: mutation.path, expected: mutation.expected, observed: inspected.state })
      }
    }
    return issues
  }

  private applyOne(mutation: FileMutation, savepoint: SavepointEntry[], created: CreatedDirectory[]): ApplyOneResult {
    this.hooks.beforeMutation?.(mutation.path)

    // Re-checked immediately before mutating, not only in the batch preflight.
    // The gap between planning and writing is exactly where a concurrent edit
    // lands, and a preflight that ran earlier proves nothing about now.
    const ancestors = inspectAncestors(mutation.path, mutation.boundary, this.sys)
    if (!ancestors.ok) {
      return { ok: false, failure: { kind: 'inspect-failed', path: mutation.path, failure: ancestors.failure } }
    }
    const inspected = inspectFileState(mutation.path, this.sys)
    if (!inspected.ok) {
      return { ok: false, failure: { kind: 'inspect-failed', path: mutation.path, failure: inspected.failure } }
    }
    if (!fileStatesEqual(inspected.state, mutation.expected)) {
      return {
        ok: false,
        failure: {
          kind: 'conflict',
          path: mutation.path,
          expected: mutation.expected,
          observed: inspected.state,
        },
      }
    }

    return mutation.kind === 'delete'
      ? this.applyDelete(mutation, inspected.state, savepoint)
      : this.applyWrite(mutation, inspected.state, savepoint, created)
  }

  private applyDelete(
    mutation: Extract<FileMutation, { kind: 'delete' }>,
    before: FileState,
    savepoint: SavepointEntry[],
  ): ApplyOneResult {
    // Armed first: an unlink can succeed and still fail to report success.
    savepoint.push({ path: mutation.path, boundary: mutation.boundary, before, latest: ABSENT_FILE })
    try {
      this.sys.unlink(mutation.path)
    } catch (error) {
      return { ok: false, failure: { kind: 'operation', failure: operationFailure('delete', mutation.path, error) } }
    }
    this.hooks.afterCommit?.(mutation.path)

    const after = inspectFileState(mutation.path, this.sys)
    if (!after.ok) {
      return { ok: false, failure: { kind: 'inspect-failed', path: mutation.path, failure: after.failure } }
    }
    if (after.state.kind !== 'absent') {
      return {
        ok: false,
        failure: { kind: 'verify-mismatch', path: mutation.path, intended: ABSENT_FILE, observed: after.state },
      }
    }
    return { ok: true }
  }

  private applyWrite(
    mutation: Extract<FileMutation, { kind: 'write' }>,
    before: FileState,
    savepoint: SavepointEntry[],
    created: CreatedDirectory[],
  ): ApplyOneResult {
    const ensured = ensureDirectories(mutation.path, mutation.boundary, this.sys)
    if (!ensured.ok) {
      return 'failure' in ensured
        ? { ok: false, failure: { kind: 'operation', failure: ensured.failure } }
        : { ok: false, failure: { kind: 'inspect-failed', path: mutation.path, failure: ensured.inspection } }
    }
    created.push(...ensured.created)

    // Replacement preserves the replaced file's permissions; a new file takes
    // whatever the process default produces, discovered rather than assumed.
    const mode = before.kind === 'regular-file' ? before.mode : null
    const staged = this.stage(mutation.path, mutation.contents, mode)
    if (!staged.ok) return { ok: false, failure: { kind: 'operation', failure: staged.failure } }

    const intended = regularFile(mutation.contents, staged.mode)
    // Armed between staging and the rename: staging cannot alter the target,
    // the rename can. This is the last instruction before the target changes.
    savepoint.push({ path: mutation.path, boundary: mutation.boundary, before, latest: intended })
    try {
      this.sys.rename(staged.path, mutation.path)
    } catch (error) {
      this.discardStaged(staged.path)
      return { ok: false, failure: { kind: 'operation', failure: operationFailure('commit', mutation.path, error) } }
    }
    this.hooks.afterCommit?.(mutation.path)

    const after = inspectFileState(mutation.path, this.sys)
    if (!after.ok) {
      return { ok: false, failure: { kind: 'inspect-failed', path: mutation.path, failure: after.failure } }
    }
    if (!fileStatesEqual(after.state, intended)) {
      return {
        ok: false,
        failure: { kind: 'verify-mismatch', path: mutation.path, intended, observed: after.state },
      }
    }
    return { ok: true }
  }

  /**
   * Write the desired bytes to a fresh name in the target's own directory.
   *
   * Same directory so the rename never crosses a filesystem; a unique name
   * created exclusively so two concurrent runs — or a stray file a user left
   * behind — can never collide on a shared temporary. `O_EXCL` makes that a
   * guarantee rather than a probability.
   */
  private stage(
    target: string,
    contents: Uint8Array,
    mode: number | null,
  ): { ok: true; path: string; mode: number } | { ok: false; failure: FileOperationFailure } {
    const directory = dirname(target)
    for (let attempt = 0; attempt < 8; attempt++) {
      const name = `.facet-tmp-${process.pid.toString(36)}-${(this.stageCounter++).toString(36)}-${randomBytes(6).toString('hex')}`
      const path = join(directory, name)
      let fd: number
      try {
        fd = this.sys.openExclusive(path, DEFAULT_NEW_FILE_MODE)
      } catch (error) {
        if (errorCode(error) === 'EEXIST') continue
        return { ok: false, failure: operationFailure('stage', path, error) }
      }

      try {
        this.sys.writeFd(fd, contents)
      } catch (error) {
        this.abandonStaged(fd, path)
        return { ok: false, failure: operationFailure('write', path, error) }
      }

      if (mode !== null) {
        try {
          this.sys.fchmod(fd, mode)
        } catch (error) {
          this.abandonStaged(fd, path)
          return { ok: false, failure: operationFailure('chmod', path, error) }
        }
      }

      let actualMode: number
      try {
        actualMode = this.sys.fstat(fd).mode & FILE_MODE_MASK
      } catch (error) {
        this.abandonStaged(fd, path)
        return { ok: false, failure: operationFailure('stage', path, error) }
      }

      try {
        this.sys.close(fd)
      } catch (error) {
        this.discardStaged(path)
        return { ok: false, failure: operationFailure('write', path, error) }
      }
      return { ok: true, path, mode: actualMode }
    }
    return {
      ok: false,
      failure: { operation: 'stage', path: target, message: 'could not create a unique temporary file' },
    }
  }

  private abandonStaged(fd: number, path: string): void {
    try {
      this.sys.close(fd)
    } catch {
      // Nothing to do; the unlink below is what actually matters.
    }
    this.discardStaged(path)
  }

  private discardStaged(path: string): void {
    try {
      this.sys.unlink(path)
    } catch {
      // A leftover temporary is inert. Failing the operation over it would
      // report a worse outcome than actually occurred.
    }
  }

  /** Undo one batch, returning every touched path to its immediate pre-batch state. */
  private unwind(savepoint: readonly SavepointEntry[], created: readonly CreatedDirectory[]): FileRollbackOutcome {
    const restored: string[] = []
    const alreadyRestored: string[] = []
    const issues: FileRollbackIssue[] = []

    for (let index = savepoint.length - 1; index >= 0; index--) {
      const entry = savepoint[index]
      if (entry === undefined) continue
      const outcome = this.restore(entry.path, entry.boundary, entry.before, entry.latest)
      switch (outcome.kind) {
        case 'restored':
          restored.push(entry.path)
          break
        case 'already-restored':
          alreadyRestored.push(entry.path)
          break
        case 'issue':
          issues.push(outcome.issue)
          break
      }
    }

    const removedDirectories = pruneCreatedDirectories(created, this.sys)
    if (isNonEmpty(issues)) {
      return { kind: 'incomplete', restored, alreadyRestored, removedDirectories, issues }
    }
    return { kind: 'complete', restored, alreadyRestored, removedDirectories }
  }

  /**
   * Put one path back, or explain why it was left alone.
   *
   * Three-way, not two-way. "Differs from the original" is not a licence to
   * write: only a file that still holds what this run put there is ours to
   * revert. Anything else belongs to whoever wrote it.
   */
  private restore(
    path: string,
    boundary: string,
    original: FileState,
    committed: FileState,
  ): { kind: 'restored' } | { kind: 'already-restored' } | { kind: 'issue'; issue: FileRollbackIssue } {
    const observed = inspectFileState(path, this.sys)
    if (!observed.ok) {
      return { kind: 'issue', issue: { kind: 'inspect-failed', path, original, committed, failure: observed.failure } }
    }
    // Compared before touching anything: a file already at its original state
    // keeps its bytes, its permissions, and its modification time, so nothing
    // watching it is woken by a rollback that had no work to do.
    if (fileStatesEqual(observed.state, original)) return { kind: 'already-restored' }
    if (!fileStatesEqual(observed.state, committed)) {
      return { kind: 'issue', issue: { kind: 'conflict', path, original, committed, observed: observed.state } }
    }

    if (original.kind === 'absent') {
      try {
        this.sys.unlink(path)
      } catch (error) {
        return {
          kind: 'issue',
          issue: {
            kind: 'restore-failed',
            path,
            original,
            committed,
            failure: operationFailure('delete', path, error),
          },
        }
      }
      return { kind: 'restored' }
    }

    const ensured = ensureDirectories(path, boundary, this.sys)
    if (!ensured.ok) {
      return 'failure' in ensured
        ? { kind: 'issue', issue: { kind: 'restore-failed', path, original, committed, failure: ensured.failure } }
        : {
            kind: 'issue',
            issue: { kind: 'inspect-failed', path, original, committed, failure: ensured.inspection },
          }
    }
    // Directories recreated to hold a restored file are not recorded as ours:
    // this transaction is unwinding, not accumulating new cleanup obligations.

    const staged = this.stage(path, original.contents, original.mode)
    if (!staged.ok) {
      return { kind: 'issue', issue: { kind: 'restore-failed', path, original, committed, failure: staged.failure } }
    }
    try {
      this.sys.rename(staged.path, path)
    } catch (error) {
      this.discardStaged(staged.path)
      return {
        kind: 'issue',
        issue: { kind: 'restore-failed', path, original, committed, failure: operationFailure('commit', path, error) },
      }
    }
    return { kind: 'restored' }
  }

  /**
   * Fold a completed batch into the durable journal.
   *
   * The original is written once and never reassigned, so repeated mutations
   * of one path collapse to a single `A → C` entry no matter how many
   * operations or adapters touched it. A path returned to its original state
   * leaves the journal entirely — there is nothing left to restore, and an
   * entry claiming otherwise would rewrite an untouched file during rollback.
   */
  private merge(savepoint: readonly SavepointEntry[], created: readonly CreatedDirectory[]): void {
    for (const entry of savepoint) {
      const existing = this.transitions.get(entry.path)
      if (existing === undefined) {
        this.transitions.set(entry.path, {
          path: entry.path,
          boundary: entry.boundary,
          original: entry.before,
          committed: entry.latest,
          order: this.order++,
        })
        continue
      }
      if (fileStatesEqual(existing.original, entry.latest)) {
        this.transitions.delete(entry.path)
        continue
      }
      existing.committed = entry.latest
    }
    this.createdDirectories.push(...created)
  }
}

type ValidateBatchResult =
  | { ok: true; mutations: readonly FileMutation[]; skipped: readonly string[] }
  | { ok: false; failures: NonEmptyArray<ValidateBatchFailure> }

/**
 * Check a batch's shape and drop the mutations that would change nothing.
 *
 * Pure: it reads no files. Everything here is a property of the plan itself,
 * so a malformed batch is rejected without a single syscall — and a caller
 * gets every problem at once rather than one per attempt.
 */
export function validateBatch(mutations: readonly FileMutation[]): ValidateBatchResult {
  const failures: ValidateBatchFailure[] = []
  const byExact = new Map<string, string>()
  const byFold = new Map<string, string>()
  const effective: FileMutation[] = []
  const skipped: string[] = []

  for (const mutation of mutations) {
    const { path, boundary } = mutation
    if (!isAbsolute(path) || path.includes('\0')) {
      failures.push({ reason: 'invalid-path', path, detail: 'must be an absolute path without NUL bytes' })
      continue
    }
    if (!isAbsolute(boundary) || boundary.includes('\0')) {
      failures.push({
        reason: 'invalid-boundary',
        path,
        boundary,
        detail: 'must be an absolute path without NUL bytes',
      })
      continue
    }

    const resolvedPath = resolve(path)
    const resolvedBoundary = resolve(boundary)
    if (resolvedPath !== path || resolvedBoundary !== boundary) {
      failures.push({ reason: 'invalid-path', path, detail: 'must already be normalized' })
      continue
    }

    const rel = relative(resolvedBoundary, resolvedPath)
    if (rel === '' || rel.startsWith('..') || rel.startsWith(`${sep}..`) || isAbsolute(rel)) {
      failures.push({ reason: 'escapes-boundary', path, boundary })
      continue
    }

    const exact = byExact.get(resolvedPath)
    if (exact !== undefined) {
      failures.push({ reason: 'duplicate-path', path, collidesWith: exact, by: 'exact' })
      continue
    }
    // A case-folding volume makes two spellings one file; a case-sensitive one
    // makes them two. Rejecting the collision is the only answer that behaves
    // identically on both, and silently merging them would lose an original.
    const folded = foldKey(resolvedPath)
    const collision = byFold.get(folded)
    if (collision !== undefined) {
      failures.push({ reason: 'duplicate-path', path, collidesWith: collision, by: 'case-fold' })
      continue
    }
    byExact.set(resolvedPath, path)
    byFold.set(folded, path)

    if (isNoOpMutation(mutation)) {
      skipped.push(path)
      continue
    }
    effective.push(mutation)
  }

  if (isNonEmpty(failures)) return { ok: false, failures }
  return { ok: true, mutations: effective, skipped }
}
