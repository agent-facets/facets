import { isAbsolute, relative } from 'node:path'
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
 *   planSingleFileInstall({ file, boundary }, body, metadata)
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
  const current = readFileState(target.file)
  if (!current.ok) return current

  const contents = encodeText(assembleAssetContent(body, metadata))
  if (stateHoldsBytes(current.state, contents)) {
    return { ok: true, plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: target.file } }
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
    },
  }
}

/**
 * Plan the removal of a single-file asset.
 *
 * An already-absent asset plans nothing and says so. Expressing it as an empty
 * batch would be indistinguishable from an adapter that forgot to plan.
 */
export function planSingleFileRemoval(target: AssetFileTarget): PlanAssetRemovalResult {
  const current = readFileState(target.file)
  if (!current.ok) return current
  if (current.state.kind === 'absent') {
    return { ok: true, plan: { kind: 'absent', primaryPath: target.file } }
  }
  return {
    ok: true,
    plan: {
      kind: 'remove',
      primaryPath: target.file,
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
 * Assert that an asset name is safe to join onto a filesystem path. Throws
 * a clear error if not. Exposed so adapter implementations can call this
 * defensively before using `name` in `path.join` — defense-in-depth at the
 * planning boundary means a malicious direct caller cannot bypass validation.
 */
export function assertSafeAssetName(name: string): void {
  const check = validateAssetName(name)
  if (!check.ok) {
    throw new Error(`asset name "${name}" ${check.reason}`)
  }
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
