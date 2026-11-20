import { isAbsolute, relative, resolve } from 'node:path'
import {
  bytesEqual,
  type FileMutation,
  type FileState,
  type InspectFileFailure,
  inspectFileState,
  splitFrontMatter,
  validateAssetName,
} from '@agent-facets/common'
import { stringify as stringifyYaml } from 'yaml'
import type { AdapterPlanFailure, PlanAssetInstallResult, PlanAssetRemovalResult } from './types.ts'

/**
 * Shared planning helpers for single-file assets (agents and commands).
 *
 * ASCII: how an adapter uses these
 *
 *   adapter.assets.planInstall(request)
 *       │
 *       ▼
 *   resolve full path  (adapter decides layout per scope/type)
 *       │
 *       ▼
 *   planSingleFileInstall({ file, boundary, storageRoot }, body, metadata)
 *       │
 *       ├─ read the file's exact current state (bytes + permissions)
 *       ├─ assemble the desired text:
 *       │      ---
 *       │      name: planning
 *       │      description: plan things
 *       │      (adapter extras)
 *       │      ---
 *       │      <body>
 *       └─ return `unchanged`, or one exact write transition
 *
 * Nothing here writes. The returned transition carries the state it was
 * computed from, so the caller can refuse it if the file changed in the
 * meantime and can restore those exact bytes if a later step fails.
 *
 * Front-matter is the single source of truth for per-asset metadata on disk
 * (no sidecar files). The body is stored verbatim after the `---\n` delimiter.
 */

/** Where a single-file asset lives, and which tree the adapter may work inside. */
export interface AssetFileTarget {
  /** Absolute path to the asset file on disk. */
  readonly file: string
  /**
   * Absolute path to the adapter-controlled root directory. Every mutation
   * must fall strictly inside it, it is never created or removed, and
   * directories the operation creates beneath it become eligible for cleanup
   * if the operation is later rolled back.
   *
   * This is what lets a user-scope asset legitimately land outside the project
   * without the caller having to trust a bare absolute path.
   */
  readonly boundary: string
  /**
   * Absolute storage root the plan discloses for this target and asset type.
   * The same for every asset of the type, whatever its name; the boundary
   * must lie at or below it and the file strictly below it.
   */
  readonly storageRoot: string
}

/** Whether `child` is `parent` or one of its descendants. */
function isAtOrInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel.length === 0 || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Check that a target's storage root truthfully contains everything the plan
 * would touch: the authorized directory at or below it, and every planned
 * path below that directory. Purely textual — run before anything is read.
 *
 * Shared by the single-file and skill-bundle planners. A plan whose disclosed
 * root did not contain its own changes would mislead every caller that
 * records the root as the place its ownership lives.
 */
export function checkStorageRoot(
  storageRoot: string,
  boundary: string,
  paths: readonly string[],
): { ok: true } | { ok: false; failure: AdapterPlanFailure } {
  const refuse = (path: string, reason: string) =>
    ({ ok: false, failure: { code: 'invalid-storage-root', storageRoot, path, reason } }) as const
  if (!isAbsolute(storageRoot)) return refuse(storageRoot, 'storage root is not an absolute path')
  const root = resolve(storageRoot)
  const authorized = resolve(boundary)
  if (!isAtOrInside(authorized, root)) return refuse(boundary, 'authorized directory is outside the storage root')
  for (const path of paths) {
    if (!isAtOrInside(resolve(path), authorized)) return refuse(path, 'path is outside the authorized directory')
  }
  return { ok: true }
}

/** Translate an inspection failure into the adapter's own failure vocabulary. */
export function planFailureForInspection(failure: InspectFileFailure): AdapterPlanFailure {
  switch (failure.reason) {
    case 'unsupported-object':
      return { code: 'unsupported-object', path: failure.path, detail: `path is a ${failure.objectKind}` }
    case 'symlinked-ancestor':
      return {
        code: 'unsupported-object',
        path: failure.path,
        detail: `reached through the symlinked directory ${failure.component}`,
      }
    case 'parent-unusable':
      return {
        code: 'unsupported-object',
        path: failure.path,
        detail: `the parent component ${failure.component} is not a directory`,
      }
    case 'unreadable':
      return { code: 'io-failed', path: failure.path, message: failure.message }
  }
}

/** Read one path's exact state, or the adapter failure explaining why not. */
export function readFileState(
  path: string,
): { ok: true; state: FileState } | { ok: false; failure: AdapterPlanFailure } {
  const inspected = inspectFileState(path)
  return inspected.ok ? inspected : { ok: false, failure: planFailureForInspection(inspected.failure) }
}

/** Whether a state already holds exactly these bytes. */
export function stateHoldsBytes(state: FileState, contents: Uint8Array): boolean {
  return state.kind === 'regular-file' && bytesEqual(state.contents, contents)
}

const encoder = new TextEncoder()

/** Encode assembled text as the bytes a transition will carry. */
export function encodeText(text: string): Uint8Array {
  return encoder.encode(text)
}

/**
 * Plan an install (or replacement) of a single-file asset.
 *
 * The desired text is a pure function of the request, so re-planning an
 * unchanged asset produces bytes identical to what is already on disk and the
 * plan reports `equivalent` with no mutation at all — no rewrite, no
 * modification-time change, and nothing for a rollback to undo.
 */
export function planSingleFileInstall(
  target: AssetFileTarget,
  body: string,
  metadata?: Record<string, unknown>,
): PlanAssetInstallResult {
  const contained = checkSingleFileTarget(target)
  if (!contained.ok) return contained

  const current = readFileState(target.file)
  if (!current.ok) return current

  const { storageRoot } = target
  const contents = encodeText(assembleAssetContent(body, metadata))
  if (stateHoldsBytes(current.state, contents)) {
    return {
      ok: true,
      plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: target.file, storageRoot },
    }
  }

  const mutation: FileMutation = {
    kind: 'write',
    path: target.file,
    boundary: target.boundary,
    expected: current.state,
    contents,
  }
  return {
    ok: true,
    plan: {
      occupancy: current.state.kind === 'absent' ? 'absent' : 'divergent',
      action: { kind: 'mutate', mutations: [mutation] },
      primaryPath: target.file,
      storageRoot,
    },
  }
}

/** A single file must lie strictly inside its authorized directory, which lies at or below the root. */
function checkSingleFileTarget(target: AssetFileTarget): { ok: true } | { ok: false; failure: AdapterPlanFailure } {
  const contained = checkStorageRoot(target.storageRoot, target.boundary, [target.file])
  if (!contained.ok) return contained
  if (!isStrictlyInside(resolve(target.file), resolve(target.boundary))) {
    return {
      ok: false,
      failure: {
        code: 'invalid-storage-root',
        storageRoot: target.storageRoot,
        path: target.file,
        reason: 'asset file must lie strictly inside the authorized directory',
      },
    }
  }
  return { ok: true }
}

/**
 * Plan the removal of a single-file asset.
 *
 * An already-absent asset plans nothing and says so. Expressing it as an empty
 * batch would be indistinguishable from an adapter that forgot to plan.
 */
export function planSingleFileRemoval(target: AssetFileTarget): PlanAssetRemovalResult {
  const contained = checkSingleFileTarget(target)
  if (!contained.ok) return contained

  const current = readFileState(target.file)
  if (!current.ok) return current
  const { storageRoot } = target
  if (current.state.kind === 'absent') {
    return { ok: true, plan: { kind: 'absent', primaryPath: target.file, storageRoot } }
  }
  return {
    ok: true,
    plan: {
      kind: 'remove',
      primaryPath: target.file,
      storageRoot,
      action: {
        kind: 'mutate',
        mutations: [{ kind: 'delete', path: target.file, boundary: target.boundary, expected: current.state }],
      },
    },
  }
}

/**
 * True when `child` is a strict descendant of `parent` (not equal to it,
 * not outside it).
 */
export function isStrictlyInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Render any thrown value as a message string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// --- front-matter helpers (exported for adapter-level customization) ---

/**
 * Assemble a full file string from optional front-matter metadata + body.
 * When `body` already contains a front-matter block, the two are merged
 * (`metadata` wins on key collision) so external keys on the body survive.
 *
 * The output is exactly `---\n<yaml>\n---\n<body>` — no separator newline
 * between the closing fence and the body. This is the inverse of
 * `splitAssetContent`'s regex (which consumes one `\n` after `---`).
 *
 * Determinism is the point: the same request must produce the same bytes every
 * time, or an unchanged asset would look divergent on every install.
 */
export function assembleAssetContent(body: string, metadata?: Record<string, unknown>): string {
  const existing = splitAssetContent(body)
  const merged = { ...(existing.metadata ?? {}), ...(metadata ?? {}) }
  const bodyOnly = existing.content
  if (Object.keys(merged).length === 0) return bodyOnly
  const yaml = stringifyYaml(merged).trimEnd()
  return `---\n${yaml}\n---\n${bodyOnly}`
}

/**
 * Parse a file string into its body + parsed front-matter metadata. Returns
 * the raw string as `content` when no front-matter is detected. Malformed
 * YAML falls back to "no front-matter."
 *
 * Thin re-export over `@agent-facets/common`'s `splitFrontMatter` so the
 * adapter SDK and the engine share one canonical implementation.
 */
export function splitAssetContent(raw: string): { content: string; metadata?: Record<string, unknown> } {
  return splitFrontMatter(raw)
}

/**
 * Check that an asset name is safe to join onto a filesystem path, as
 * failure data an adapter can return directly.
 *
 * `defineAdapter` applies this to every asset request before the planner
 * runs. It is exported for adapters assembled without the factory, and for
 * defense in depth before a name reaches `path.join` — an unsafe name from a
 * direct caller is an expected input to refuse, not a crash.
 */
export function checkSafeAssetName(name: unknown): { ok: true } | { ok: false; failure: AdapterPlanFailure } {
  if (typeof name !== 'string') {
    return { ok: false, failure: { code: 'invalid-asset-name', name: String(name), reason: 'must be a string' } }
  }
  const check = validateAssetName(name)
  return check.ok ? { ok: true } : { ok: false, failure: { code: 'invalid-asset-name', name, reason: check.reason } }
}

/** Result of {@link validateContainedRelativePath}. */
export type ContainedRelativePathResult = { ok: true } | { ok: false; reason: string }

/**
 * Validate a companion path as relative, canonical, and confined below a
 * skill root — purely textually, before any filesystem access.
 *
 * Rejects: empty paths, absolute paths (POSIX and Windows drive/UNC
 * forms), backslashes, NUL bytes, and empty, `.`, or `..` segments.
 * A path passing this check joined onto the skill root cannot resolve
 * outside it.
 */
export function validateContainedRelativePath(path: string): ContainedRelativePathResult {
  if (path.length === 0) return { ok: false, reason: 'path is empty' }
  if (path.includes('\0')) return { ok: false, reason: 'path contains a NUL byte' }
  if (path.includes('\\')) return { ok: false, reason: 'path contains a backslash' }
  if (path.startsWith('/')) return { ok: false, reason: 'path is absolute' }
  if (/^[A-Za-z]:/.test(path)) return { ok: false, reason: 'path has a Windows drive prefix' }
  for (const segment of path.split('/')) {
    if (segment === '') return { ok: false, reason: 'path has an empty segment' }
    if (segment === '.') return { ok: false, reason: 'path has a "." segment' }
    if (segment === '..') return { ok: false, reason: 'path has a ".." segment' }
  }
  return { ok: true }
}
