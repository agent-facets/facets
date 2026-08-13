/**
 * The shared file vocabulary: what a file is, and what a planner may ask to
 * happen to it.
 *
 * These types are the contract between a component that *decides* what should
 * change (an adapter's planner, a manifest writer) and the component that
 * *performs* the change (the engine's filesystem transaction). They describe
 * files — not assets, servers, skills, manifests, or ownership. Nothing here
 * knows what a facet is.
 *
 * They live in `common` because both sides of that contract are published
 * packages that cannot depend on the engine.
 */

/**
 * The exact state of one path, restricted to the two shapes this system is
 * willing to write or restore.
 *
 * `mode` travels with the bytes because replacement is implemented as
 * create-then-rename, which produces a *new* inode: without carrying the
 * permission bits, replacing an executable file would silently drop its
 * executable bit, and restoring it afterwards would restore the bytes but not
 * the ability to run them.
 *
 * Every other filesystem object — symlink, directory, FIFO, socket, device,
 * hard-linked file — is deliberately absent from this union. Such a path is
 * not a state a plan may target; it is an inspection failure.
 */
export type FileState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'regular-file'; readonly contents: Uint8Array; readonly mode: number }

/** The `regular-file` arm, for callers that have already excluded absence. */
export type RegularFileState = Extract<FileState, { kind: 'regular-file' }>

/**
 * One intended change to one path.
 *
 * `expected` is the state the planner observed and from which it computed the
 * change. It is the transaction's precondition: if the path no longer holds
 * that state when the mutation is about to run, something else has written it
 * and the operation is refused rather than applied over a stranger's edit.
 *
 * `boundary` is the directory this mutation is authorized to work inside. It
 * must already exist, is never removed, and every path must be strictly below
 * it. It is what lets a user-scope asset legitimately write outside the
 * project tree without the transaction having to trust a bare absolute path.
 *
 * A `write` carries no mode: the transaction preserves the replaced file's
 * permissions, and a newly created file takes the process default. A planner
 * that could name a mode could contradict the state it claims to have read.
 *
 * A `delete` narrows `expected` to `regular-file`, so "delete a path I
 * observed as absent" — a no-op that would otherwise need a runtime guard —
 * cannot be expressed at all.
 */
export type FileMutation =
  | {
      readonly kind: 'write'
      readonly path: string
      readonly boundary: string
      readonly expected: FileState
      readonly contents: Uint8Array
    }
  | {
      readonly kind: 'delete'
      readonly path: string
      readonly boundary: string
      readonly expected: RegularFileState
    }

/**
 * What a planner concluded about one logical operation.
 *
 * `unchanged` is a first-class answer, not an empty mutation list: "this asset
 * already matches" and "this asset needs these three files written" are
 * different facts, and a caller that had to distinguish them by checking
 * `mutations.length` could forget. The `mutate` arm's list is non-empty by
 * type, so the two can never overlap.
 */
export type FileMutationAction =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'mutate'; readonly mutations: readonly [FileMutation, ...FileMutation[]] }

/** The absent state. A shared value; `FileState` is deeply immutable. */
export const ABSENT_FILE: FileState = { kind: 'absent' }

/** Build a regular-file state. */
export function regularFile(contents: Uint8Array, mode: number): RegularFileState {
  return { kind: 'regular-file', contents, mode }
}

/** Exact byte equality. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Whether two states are the same state — same existence, same bytes, same
 * permissions.
 *
 * Mode participates: a file whose bytes are unchanged but whose executable bit
 * was stripped is not the state we left behind, and treating it as such would
 * report a clean rollback over a real difference.
 */
export function fileStatesEqual(a: FileState, b: FileState): boolean {
  if (a.kind === 'absent' || b.kind === 'absent') return a.kind === b.kind
  return a.mode === b.mode && bytesEqual(a.contents, b.contents)
}

/**
 * Whether a mutation would change nothing.
 *
 * Only a `write` can be a no-op — a `delete` cannot, by construction. A no-op
 * must never reach the filesystem: rewriting identical bytes changes the
 * modification time and wakes every tool watching that file, and journaling it
 * would claim a transition this run never made.
 */
export function isNoOpMutation(mutation: FileMutation): boolean {
  if (mutation.kind === 'delete') return false
  return mutation.expected.kind === 'regular-file' && bytesEqual(mutation.expected.contents, mutation.contents)
}
