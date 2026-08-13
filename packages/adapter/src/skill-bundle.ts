import { basename, join, resolve } from 'node:path'
import type { FileMutation, FileState } from '@agent-facets/common'
import {
  assembleAssetContent,
  encodeText,
  isStrictlyInside,
  readFileState,
  stateHoldsBytes,
  validateContainedRelativePath,
} from './asset-fs.ts'
import type {
  AdapterPlanFailure,
  AssetOccupancy,
  CompanionMap,
  PlanAssetInstallResult,
  PlanAssetRemovalResult,
} from './types.ts'

/**
 * Planning helpers for skill bundles: a primary `SKILL.md` plus the companion
 * files a previous install owned.
 *
 * A skill is the one asset whose materialization spans several files, and the
 * three of them are one logical change: the new primary, the new companions,
 * and the removal of owned companions the new bundle no longer contains. They
 * are returned as a single batch so the caller applies them atomically — a
 * handled failure can never leave half a bundle behind.
 *
 * Ownership is supplied, never discovered. These helpers read exactly the
 * paths they are given and never enumerate the skill directory, so a file a
 * user dropped in beside the bundle is never read, never planned over, and
 * never swept into a removal.
 */

/** Where a skill bundle lives, and which tree the adapter may work inside. */
export interface SkillBundleTarget {
  /** Absolute path of the skill root directory (e.g. `<base>/skills/<name>`). */
  readonly root: string
  /** Absolute path of the primary file (e.g. `<root>/SKILL.md`). Must be inside `root`. */
  readonly primaryFile: string
  /**
   * Absolute path of the adapter-controlled base directory. Every mutation
   * must fall strictly inside it; it is never created or removed.
   */
  readonly boundary: string
}

/** What a skill install plans to put on disk. */
export interface SkillBundleContent {
  /** Primary file text, before front-matter assembly. */
  readonly content: string
  readonly metadata?: Record<string, unknown> | undefined
  /** The complete new companion bundle, keyed relative to the skill root. */
  readonly companions: CompanionMap
  /** Caller-verified companion paths a previous install owned. */
  readonly ownedCompanionPaths: readonly string[]
}

/**
 * A portable collision key: NFC-normalized and case-folded, so two paths that
 * are distinct byte sequences but name one file on a case-insensitive volume
 * are caught before one silently overwrites the other.
 */
function collisionKey(relPath: string): string {
  return relPath.normalize('NFC').toLowerCase()
}

interface ResolvedCompanions {
  readonly ok: true
  /** Relative path → absolute path, in supplied order. */
  readonly resolved: Map<string, string>
}

/**
 * Validate every supplied companion path and resolve it below the skill root.
 *
 * Enforces, in order:
 *
 *  - the resolved primary is a strict descendant of the skill root (a public
 *    SDK caller could otherwise point `primaryFile` at an external file);
 *  - each companion is textually relative, canonical, and contained;
 *  - the primary filename is never a companion — it would overwrite the
 *    assembled primary or delete it as "stale";
 *  - no two companions collide by portable case-fold/NFC form;
 *  - the resolved companion is a strict descendant of the root (defense in
 *    depth against a textual-validator bug).
 *
 * Symlinked intermediate directories are deliberately NOT checked here. The
 * caller re-inspects every path and refuses to write through a symlinked
 * component beneath the boundary, so duplicating the walk would mean two
 * implementations of one rule that could disagree.
 */
function resolveCompanionPaths(
  target: SkillBundleTarget,
  supplied: Iterable<string>,
): ResolvedCompanions | { ok: false; failure: AdapterPlanFailure } {
  const root = resolve(target.root)
  const primaryAbs = resolve(target.primaryFile)
  if (!isStrictlyInside(primaryAbs, root)) {
    return {
      ok: false,
      failure: {
        code: 'invalid-companion-path',
        path: target.primaryFile,
        reason: 'primary file escapes the skill root',
      },
    }
  }
  const primaryName = basename(primaryAbs)

  const resolved = new Map<string, string>()
  const seen = new Map<string, string>()
  for (const relPath of supplied) {
    if (resolved.has(relPath)) continue

    const check = validateContainedRelativePath(relPath)
    if (!check.ok) {
      return { ok: false, failure: { code: 'invalid-companion-path', path: relPath, reason: check.reason } }
    }

    const abs = resolve(join(root, relPath))
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
    if (!isStrictlyInside(abs, root)) {
      return {
        ok: false,
        failure: { code: 'invalid-companion-path', path: relPath, reason: 'path escapes the skill root' },
      }
    }

    const key = collisionKey(relPath)
    const clash = seen.get(key)
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
    seen.set(key, relPath)
    resolved.set(relPath, abs)
  }
  return { ok: true, resolved }
}

/**
 * Plan the complete replacement of a skill bundle.
 *
 * The batch contains, in order: the primary, every companion whose bytes
 * differ, and a deletion for every owned companion the new bundle drops. An
 * unchanged file contributes nothing — not a no-op write — so re-installing a
 * skill touches no modification times and journals nothing.
 */
export function planSkillBundleInstall(target: SkillBundleTarget, bundle: SkillBundleContent): PlanAssetInstallResult {
  const newPaths = Object.keys(bundle.companions)
  const resolvedResult = resolveCompanionPaths(target, [...newPaths, ...bundle.ownedCompanionPaths])
  if (!resolvedResult.ok) return resolvedResult
  const { resolved } = resolvedResult

  const mutations: FileMutation[] = []
  let differs = false

  const primaryState = readFileState(target.primaryFile)
  if (!primaryState.ok) return primaryState
  const primaryBytes = encodeText(assembleAssetContent(bundle.content, bundle.metadata))
  if (!stateHoldsBytes(primaryState.state, primaryBytes)) {
    differs = true
    mutations.push({
      kind: 'write',
      path: target.primaryFile,
      boundary: target.boundary,
      expected: primaryState.state,
      contents: primaryBytes,
    })
  }

  for (const relPath of newPaths) {
    const abs = resolved.get(relPath)
    const contents = bundle.companions[relPath]
    if (abs === undefined || contents === undefined) continue
    const state = readFileState(abs)
    if (!state.ok) return state
    if (stateHoldsBytes(state.state, contents)) continue
    differs = true
    mutations.push({ kind: 'write', path: abs, boundary: target.boundary, expected: state.state, contents })
  }

  // Exactly the owned paths the new bundle no longer contains. Anything the
  // caller did not name as owned is somebody else's file and is untouched.
  const retained = new Set(newPaths.map(collisionKey))
  for (const relPath of bundle.ownedCompanionPaths) {
    if (retained.has(collisionKey(relPath))) continue
    const abs = resolved.get(relPath)
    if (abs === undefined) continue
    const state = readFileState(abs)
    if (!state.ok) return state
    if (state.state.kind !== 'regular-file') continue
    differs = true
    mutations.push({ kind: 'delete', path: abs, boundary: target.boundary, expected: state.state })
  }

  if (!differs) {
    return {
      ok: true,
      plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: target.primaryFile },
    }
  }

  const [first, ...rest] = mutations
  if (first === undefined) {
    return {
      ok: true,
      plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: target.primaryFile },
    }
  }

  // A bundle whose primary is absent is a fresh install even when a stray
  // owned companion survives from a previous one; the user is not being asked
  // to give up a skill they can see.
  const occupancy: Exclude<AssetOccupancy, 'equivalent'> = primaryState.state.kind === 'absent' ? 'absent' : 'divergent'
  return {
    ok: true,
    plan: { occupancy, action: { kind: 'mutate', mutations: [first, ...rest] }, primaryPath: target.primaryFile },
  }
}

/**
 * Plan the removal of a skill bundle: the primary plus exactly the
 * caller-supplied owned companions, and nothing else.
 *
 * A bundle whose primary is already gone is still removable — the owned
 * companions have exact states of their own, so they can be deleted and, if
 * the operation later fails, restored byte for byte.
 */
export function planSkillBundleRemoval(
  target: SkillBundleTarget,
  ownedCompanionPaths: readonly string[],
): PlanAssetRemovalResult {
  const resolvedResult = resolveCompanionPaths(target, ownedCompanionPaths)
  if (!resolvedResult.ok) return resolvedResult

  const mutations: FileMutation[] = []
  const addDeletion = (path: string, state: FileState): void => {
    if (state.kind !== 'regular-file') return
    mutations.push({ kind: 'delete', path, boundary: target.boundary, expected: state })
  }

  const primaryState = readFileState(target.primaryFile)
  if (!primaryState.ok) return primaryState
  addDeletion(target.primaryFile, primaryState.state)

  for (const abs of resolvedResult.resolved.values()) {
    const state = readFileState(abs)
    if (!state.ok) return state
    addDeletion(abs, state.state)
  }

  const [first, ...rest] = mutations
  if (first === undefined) {
    return { ok: true, plan: { kind: 'absent', primaryPath: target.primaryFile } }
  }
  return {
    ok: true,
    plan: {
      kind: 'remove',
      primaryPath: target.primaryFile,
      action: { kind: 'mutate', mutations: [first, ...rest] },
    },
  }
}
