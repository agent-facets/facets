import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { FileMutation, FileState } from '@agent-facets/common'
import { inspectFileState } from '@agent-facets/common'
import { nodeFsSyscalls } from '../syscalls.ts'
import { FileTransaction } from '../transaction.ts'
import { bytes, faultAfter, faultBefore, makeTempRoot, occupyOnMkdir, removeTempRoot } from './helpers.ts'

let root: string
let outside: string

beforeEach(() => {
  root = makeTempRoot('facet-fs-txn-')
  outside = makeTempRoot('facet-fs-outside-')
})

afterEach(() => {
  removeTempRoot(root)
  removeTempRoot(outside)
})

/** The state a planner would have observed. */
function observe(path: string): FileState {
  const result = inspectFileState(path, nodeFsSyscalls)
  if (!result.ok) expect.unreachable()
  return result.state
}

function write(path: string, contents: string, boundary = root): FileMutation {
  return { kind: 'write', path, boundary, expected: observe(path), contents: bytes(contents) }
}

function remove(path: string, boundary = root): FileMutation {
  const expected = observe(path)
  if (expected.kind !== 'regular-file') expect.unreachable()
  return { kind: 'delete', path, boundary, expected }
}

function mutate(...mutations: FileMutation[]) {
  const [first, ...rest] = mutations
  if (first === undefined) expect.unreachable()
  return { kind: 'mutate' as const, mutations: [first, ...rest] as const }
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('applying a batch', () => {
  test('creates a file and journals absent → regular', () => {
    const transaction = new FileTransaction(nodeFsSyscalls)
    const file = join(root, 'agents', 'reviewer.md')

    const result = transaction.apply(mutate(write(file, 'reviewer\n')))

    expect(result.ok).toBe(true)
    expect(read(file)).toBe('reviewer\n')
    const journal = transaction.journal()
    expect(journal).toHaveLength(1)
    expect(journal[0]?.original.kind).toBe('absent')
    expect(journal[0]?.committed.kind).toBe('regular-file')
  })

  test('replaces a file and preserves its permission bits', () => {
    const file = join(root, 'hook.sh')
    writeFileSync(file, 'old\n')
    chmodSync(file, 0o755)

    const transaction = new FileTransaction(nodeFsSyscalls)
    const result = transaction.apply(mutate(write(file, 'new\n')))

    expect(result.ok).toBe(true)
    expect(read(file)).toBe('new\n')
    expect(statSync(file).mode & 0o777).toBe(0o755)
  })

  test('deletes a file and journals regular → absent', () => {
    const file = join(root, 'commands', 'old.md')
    mkdirSync(join(root, 'commands'))
    writeFileSync(file, 'gone soon\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    const result = transaction.apply(mutate(remove(file)))

    expect(result.ok).toBe(true)
    expect(existsSync(file)).toBe(false)
    expect(transaction.journal()[0]?.committed.kind).toBe('absent')
  })

  test('eliminates a no-op write: nothing is journaled and the file is not touched', () => {
    const file = join(root, 'same.md')
    writeFileSync(file, 'identical\n')
    const past = new Date(Date.now() - 60_000)
    utimesSync(file, past, past)
    const before = statSync(file)

    const transaction = new FileTransaction(nodeFsSyscalls)
    const result = transaction.apply(mutate(write(file, 'identical\n')))

    if (!result.ok) expect.unreachable()
    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([file])
    expect(transaction.hasMutations()).toBe(false)

    const after = statSync(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.ino).toBe(before.ino)
  })
})

describe('refusing a batch before anything is armed', () => {
  test('rejects a path outside its authorized boundary', () => {
    const transaction = new FileTransaction(nodeFsSyscalls)
    const outside = join(root, '..', 'escape.md')

    const result = transaction.apply(
      mutate({ kind: 'write', path: outside, boundary: root, expected: { kind: 'absent' }, contents: bytes('x') }),
    )

    if (result.ok) expect.unreachable()
    expect(result.stage).toBe('refused')
    expect(existsSync(outside)).toBe(false)
  })

  test('rejects two mutations targeting one path', () => {
    const file = join(root, 'dup.md')
    const transaction = new FileTransaction(nodeFsSyscalls)

    const result = transaction.apply(mutate(write(file, 'one'), write(file, 'two')))

    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'invalid-batch') expect.unreachable()
    expect(result.failure.failures[0].reason).toBe('duplicate-path')
  })

  test('refuses when the observed state drifted after planning', () => {
    const file = join(root, 'drifted.md')
    writeFileSync(file, 'planned against this\n')
    const mutation = write(file, 'our new content\n')
    writeFileSync(file, 'somebody else got here first\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    const result = transaction.apply(mutate(mutation))

    if (result.ok) expect.unreachable()
    expect(result.stage).toBe('refused')
    if (result.failure.kind !== 'preflight') expect.unreachable()
    expect(result.failure.issues[0].kind).toBe('drift')
    expect(read(file)).toBe('somebody else got here first\n')
    expect(transaction.hasMutations()).toBe(false)
  })

  test('refuses a path reached through a symlinked directory', () => {
    mkdirSync(join(root, 'real'))
    symlinkSync(join(root, 'real'), join(root, 'linked'))
    const file = join(root, 'linked', 'inside.md')

    const transaction = new FileTransaction(nodeFsSyscalls)
    const result = transaction.apply(
      mutate({ kind: 'write', path: file, boundary: root, expected: { kind: 'absent' }, contents: bytes('x') }),
    )

    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'preflight') expect.unreachable()
    const issue = result.failure.issues[0]
    if (issue.kind !== 'inspect-failed') expect.unreachable()
    expect(issue.failure.reason).toBe('symlinked-ancestor')
    expect(existsSync(join(root, 'real', 'inside.md'))).toBe(false)
  })

  test('refuses an unsupported object standing at the target', () => {
    const path = join(root, 'occupied')
    mkdirSync(path)

    const transaction = new FileTransaction(nodeFsSyscalls)
    const result = transaction.apply(
      mutate({ kind: 'write', path, boundary: root, expected: { kind: 'absent' }, contents: bytes('x') }),
    )

    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'preflight') expect.unreachable()
    const issue = result.failure.issues[0]
    if (issue.kind !== 'inspect-failed') expect.unreachable()
    expect(issue.failure.reason).toBe('unsupported-object')
  })
})

describe('batch atomicity', () => {
  test('a write that lands and then reports failure is still undone', () => {
    const file = join(root, 'landed.md')
    writeFileSync(file, 'original\n')

    const transaction = new FileTransaction(faultAfter('rename', (path) => path === file))
    const result = transaction.apply(mutate(write(file, 'replacement\n')))

    if (result.ok) expect.unreachable()
    if (result.stage !== 'aborted') expect.unreachable()
    expect(result.rollback.kind).toBe('complete')
    expect(read(file)).toBe('original\n')
    expect(transaction.hasMutations()).toBe(false)
  })

  test('a failed multi-file batch leaves its complete pre-batch state intact', () => {
    mkdirSync(join(root, 'skills', 'planning'), { recursive: true })
    const primary = join(root, 'skills', 'planning', 'SKILL.md')
    const companion = join(root, 'skills', 'planning', 'notes.md')
    const obsolete = join(root, 'skills', 'planning', 'legacy.md')
    writeFileSync(primary, 'primary v1\n')
    writeFileSync(companion, 'companion v1\n')
    writeFileSync(obsolete, 'legacy\n')

    const doomed = join(root, 'skills', 'planning', 'extra.md')
    const transaction = new FileTransaction(faultBefore('rename', (path) => path === doomed))

    const result = transaction.apply(
      mutate(
        write(primary, 'primary v2\n'),
        write(companion, 'companion v2\n'),
        remove(obsolete),
        write(doomed, 'new\n'),
      ),
    )

    if (result.ok) expect.unreachable()
    if (result.stage !== 'aborted') expect.unreachable()
    expect(result.rollback.kind).toBe('complete')
    expect(read(primary)).toBe('primary v1\n')
    expect(read(companion)).toBe('companion v1\n')
    expect(read(obsolete)).toBe('legacy\n')
    expect(existsSync(doomed)).toBe(false)
    expect(transaction.hasMutations()).toBe(false)
  })

  test('an aborted batch does not merge into the journal of an earlier successful one', () => {
    const kept = join(root, 'kept.md')
    const doomed = join(root, 'doomed.md')
    writeFileSync(kept, 'v1\n')

    const transaction = new FileTransaction(faultBefore('rename', (path) => path === doomed))
    expect(transaction.apply(mutate(write(kept, 'v2\n'))).ok).toBe(true)
    expect(transaction.apply(mutate(write(doomed, 'never\n'))).ok).toBe(false)

    expect(transaction.journal().map((entry) => entry.path)).toEqual([kept])
  })
})

/**
 * The preflight walks a path's ancestors, but stops at the first component
 * that does not exist yet — the write creates the rest. Everything from there
 * to the staging open is guarded by directory creation alone.
 */
describe('losing the mkdir race mid-batch', () => {
  test('refuses to write through a symlink that appeared below the boundary', () => {
    const component = join(root, 'agents')
    const file = join(component, 'reviewer.md')
    const sys = occupyOnMkdir(
      (path) => path === component,
      (path) => symlinkSync(outside, path),
    )

    const transaction = new FileTransaction(sys)
    const result = transaction.apply(
      mutate({ kind: 'write', path: file, boundary: root, expected: { kind: 'absent' }, contents: bytes('body\n') }),
    )

    if (result.ok) expect.unreachable()
    if (result.stage !== 'aborted') expect.unreachable()
    if (result.failure.kind !== 'inspect-failed') expect.unreachable()
    expect(result.failure.failure.reason).toBe('symlinked-ancestor')
    expect(result.rollback.kind).toBe('complete')
    expect(existsSync(join(outside, 'reviewer.md'))).toBe(false)
    expect(transaction.hasMutations()).toBe(false)
  })

  test('refuses on the rollback path too, where no ancestor walk precedes it', () => {
    mkdirSync(join(root, 'nested'))
    const file = join(root, 'nested', 'doc.md')
    writeFileSync(file, 'body\n')

    // Deleting the file sweeps the directory it emptied, so the rollback has
    // to recreate it — the one call site with no preflight in front of it.
    const sys = occupyOnMkdir(
      (path) => path === join(root, 'nested'),
      (path) => symlinkSync(outside, path),
    )
    const transaction = new FileTransaction(sys)
    expect(transaction.apply(mutate(remove(file))).ok).toBe(true)
    expect(existsSync(join(root, 'nested'))).toBe(false)

    const outcome = transaction.rollback()

    if (outcome.kind !== 'incomplete') expect.unreachable()
    const issue = outcome.issues[0]
    if (issue.kind !== 'inspect-failed') expect.unreachable()
    expect(issue.failure.reason).toBe('symlinked-ancestor')
    expect(existsSync(join(outside, 'doc.md'))).toBe(false)
  })
})

describe('coalescing repeated mutations of one path', () => {
  test('A → B → C collapses to A → C', () => {
    const file = join(root, 'config.json')
    writeFileSync(file, 'A\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    expect(transaction.apply(mutate(write(file, 'B\n'))).ok).toBe(true)
    expect(transaction.apply(mutate(write(file, 'C\n'))).ok).toBe(true)

    const journal = transaction.journal()
    expect(journal).toHaveLength(1)
    const entry = journal[0]
    if (entry?.original.kind !== 'regular-file') expect.unreachable()
    if (entry.committed.kind !== 'regular-file') expect.unreachable()
    expect(new TextDecoder().decode(entry.original.contents)).toBe('A\n')
    expect(new TextDecoder().decode(entry.committed.contents)).toBe('C\n')
  })

  test('a path returned to its original state leaves the journal entirely', () => {
    const file = join(root, 'config.json')
    writeFileSync(file, 'A\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'B\n')))
    transaction.apply(mutate(write(file, 'A\n')))

    expect(transaction.journal()).toHaveLength(0)
    expect(transaction.hasMutations()).toBe(false)
  })

  test('a created-then-deleted path leaves nothing to restore', () => {
    const file = join(root, 'ephemeral.md')

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'temp\n')))
    transaction.apply(mutate(remove(file)))

    expect(transaction.journal()).toHaveLength(0)
  })
})

describe('rolling back', () => {
  test('restores exact bytes and permissions', () => {
    const file = join(root, 'secret.env')
    writeFileSync(file, 'TOKEN=abc\n')
    chmodSync(file, 0o600)

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'TOKEN=zzz\n')))

    const outcome = transaction.rollback()

    expect(outcome.kind).toBe('complete')
    expect(read(file)).toBe('TOKEN=abc\n')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  test('returns a created file to absence', () => {
    const file = join(root, 'created.md')
    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'new\n')))

    expect(transaction.rollback().kind).toBe('complete')
    expect(existsSync(file)).toBe(false)
  })

  test('restores a deleted file byte for byte', () => {
    const file = join(root, 'deleted.md')
    writeFileSync(file, 'irreplaceable\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(remove(file)))
    expect(existsSync(file)).toBe(false)

    expect(transaction.rollback().kind).toBe('complete')
    expect(read(file)).toBe('irreplaceable\n')
  })

  test('recreates a parent directory removed after the delete', () => {
    mkdirSync(join(root, 'nested'))
    const file = join(root, 'nested', 'doc.md')
    writeFileSync(file, 'body\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(remove(file)))
    // The delete already swept the directory it emptied, which is the point:
    // removing a file must not leave its now-empty folder behind.
    expect(existsSync(join(root, 'nested'))).toBe(false)

    expect(transaction.rollback().kind).toBe('complete')
    expect(read(file)).toBe('body\n')
  })

  test('leaves a file untouched when it already holds its original state', () => {
    const file = join(root, 'reverted.md')
    writeFileSync(file, 'original\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'changed\n')))
    writeFileSync(file, 'original\n')
    const before = statSync(file)

    const outcome = transaction.rollback()

    if (outcome.kind !== 'complete') expect.unreachable()
    expect(outcome.alreadyRestored).toEqual([file])
    expect(statSync(file).mtimeMs).toBe(before.mtimeMs)
  })

  test('preserves a concurrent edit, reports it, and keeps restoring everything else', () => {
    const contested = join(root, 'contested.md')
    const untouched = join(root, 'other.md')
    writeFileSync(contested, 'A\n')
    writeFileSync(untouched, 'A\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(contested, 'B\n'), write(untouched, 'B\n')))

    writeFileSync(contested, "B'-somebody else\n")

    const outcome = transaction.rollback()

    if (outcome.kind !== 'incomplete') expect.unreachable()
    expect(outcome.issues).toHaveLength(1)
    const issue = outcome.issues[0]
    expect(issue.kind).toBe('conflict')
    expect(issue.path).toBe(contested)
    expect(read(contested)).toBe("B'-somebody else\n")
    expect(outcome.restored).toEqual([untouched])
    expect(read(untouched)).toBe('A\n')
  })

  test('never journals a file that was only inspected, so a concurrent edit to it survives', () => {
    const inspected = join(root, 'read-only-input.md')
    const written = join(root, 'written.md')
    writeFileSync(inspected, 'input\n')
    writeFileSync(written, 'A\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    // The planner read `inspected` to compute this change but never targets it.
    observe(inspected)
    transaction.apply(mutate(write(written, 'B\n')))

    writeFileSync(inspected, 'edited by another process\n')

    expect(transaction.journal().map((entry) => entry.path)).toEqual([written])
    expect(transaction.rollback().kind).toBe('complete')
    expect(read(inspected)).toBe('edited by another process\n')
  })

  test('reports a restore that cannot complete, and still restores the others', () => {
    const created = join(root, 'created.md')
    const replaced = join(root, 'replaced.md')
    writeFileSync(replaced, 'A\n')

    // Only the rollback of `created` needs an unlink, so faulting it leaves
    // the forward pass untouched — the failure is genuinely in the restore.
    const transaction = new FileTransaction(faultBefore('unlink', (path) => path === created))
    transaction.apply(mutate(write(created, 'new\n'), write(replaced, 'B\n')))

    const outcome = transaction.rollback()

    if (outcome.kind !== 'incomplete') expect.unreachable()
    expect(outcome.issues).toHaveLength(1)
    expect(outcome.issues[0].kind).toBe('restore-failed')
    expect(outcome.issues[0].path).toBe(created)
    expect(read(created)).toBe('new\n')
    expect(outcome.restored).toEqual([replaced])
    expect(read(replaced)).toBe('A\n')
  })

  test('draining the journal makes a second rollback a no-op', () => {
    const file = join(root, 'once.md')
    writeFileSync(file, 'A\n')

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'B\n')))
    expect(transaction.rollback().kind).toBe('complete')

    writeFileSync(file, 'C\n')
    const second = transaction.rollback()
    if (second.kind !== 'complete') expect.unreachable()
    expect(second.restored).toEqual([])
    expect(read(file)).toBe('C\n')
  })
})

describe('directory cleanup', () => {
  test('removes only the directories the transaction created', () => {
    const preExisting = join(root, 'pre-existing-empty')
    mkdirSync(preExisting)
    const file = join(root, 'made', 'deeper', 'asset.md')

    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'body\n')))
    expect(existsSync(join(root, 'made', 'deeper'))).toBe(true)

    const outcome = transaction.rollback()

    if (outcome.kind !== 'complete') expect.unreachable()
    expect(existsSync(join(root, 'made'))).toBe(false)
    expect(existsSync(preExisting)).toBe(true)
    expect(outcome.removedDirectories).toContain(join(root, 'made', 'deeper'))
  })

  test('an unowned file prevents pruning and is left untouched', () => {
    const file = join(root, 'made', 'asset.md')
    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'body\n')))

    const stranger = join(root, 'made', 'stranger.md')
    writeFileSync(stranger, 'not ours\n')

    expect(transaction.rollback().kind).toBe('complete')
    expect(existsSync(file)).toBe(false)
    expect(existsSync(join(root, 'made'))).toBe(true)
    expect(read(stranger)).toBe('not ours\n')
  })

  test('sweeps directories a refused walk created before it stopped', () => {
    const blocked = join(root, 'made', 'blocked')
    const file = join(blocked, 'asset.md')
    // `made` is created, then the walk is refused at `blocked`.
    const sys = faultBefore('mkdir', (path) => path === blocked)

    const transaction = new FileTransaction(sys)
    const result = transaction.apply(
      mutate({ kind: 'write', path: file, boundary: root, expected: { kind: 'absent' }, contents: bytes('x') }),
    )

    if (result.ok) expect.unreachable()
    if (result.stage !== 'aborted') expect.unreachable()
    expect(result.rollback.removedDirectories).toContain(join(root, 'made'))
    expect(existsSync(join(root, 'made'))).toBe(false)
  })

  test('a directory recreated by someone else is no longer ours to remove', () => {
    const file = join(root, 'made', 'asset.md')
    const transaction = new FileTransaction(nodeFsSyscalls)
    transaction.apply(mutate(write(file, 'body\n')))

    // Same path, different inode: emptiness is not evidence of ownership.
    rmSync(file)
    rmdirSync(join(root, 'made'))
    mkdirSync(join(root, 'made'))

    const outcome = transaction.rollback()

    if (outcome.kind !== 'complete') expect.unreachable()
    expect(outcome.removedDirectories).toEqual([])
    expect(existsSync(join(root, 'made'))).toBe(true)
  })
})
