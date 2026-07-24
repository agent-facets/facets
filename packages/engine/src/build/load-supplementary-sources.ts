import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type { ValidationError } from '@agent-facets/common'
import type { ArchiveEntry, ArchivePlanEntry, ResolvedFacetManifest } from '@agent-facets/protocol'

/**
 * Loads and validates the on-disk source of every declared supplementary
 * file (skill companions and archive-only files) before the build produces
 * any output. This is the filesystem-identity layer that sits on top of
 * protocol's pure path-grammar layer (design D7): the archive plan has
 * already proven the *spelling* of every path is safe and collision-free;
 * this module proves the *resolved source* is a real, contained, regular
 * file — symlinks (target or parent), hard links, non-regular files, and
 * out-of-tree escapes are all rejected.
 *
 * Primary assets (`manifest`, `primary-asset`) are NOT handled here — the
 * existing `resolvePrompts` path owns those. Only `skill-companion` and
 * `archive-only` plan entries carry supplementary bytes.
 *
 * The check-then-read sequence has an irreducible TOCTOU window: `lstat`,
 * `realpath`, and the final `readFile` are separate syscalls, so a path
 * could in principle be swapped between validation and read. Build is a
 * single-process operation over the author's own trusted source tree, so
 * the threat model is malformed or accidental inputs (a stray symlink, a
 * `README` that is actually a directory), not an active attacker racing the
 * builder. We mitigate what we can — we read the same resolved absolute path
 * we validated, and the bytes we hash are always the bytes we actually read —
 * and accept the residual window rather than reaching for non-portable
 * `openat`/`O_NOFOLLOW` primitives Node/Bun do not expose.
 */

/** One resolved, verified supplementary source ready for archiving. */
export interface LoadedSupplementaryFile {
  /** Canonical inner-archive path (from the archive plan). */
  archivePath: string
  /** Exact source bytes, read verbatim — binary and empty permitted (D6). */
  content: Uint8Array
}

/**
 * Pure-data failure for a single supplementary source. Discriminated by
 * `code` so every failure class is distinguishable without parsing
 * messages, and so the 11.5 test matrix gets one case per class.
 */
export type SupplementarySourceFailure =
  | { code: 'missing'; archivePath: string; declarationSite: string; sourcePath: string }
  | {
      code: 'not-regular-file'
      archivePath: string
      declarationSite: string
      sourcePath: string
      kind: 'directory' | 'symlink' | 'other'
    }
  | { code: 'symlinked-parent'; archivePath: string; declarationSite: string; sourcePath: string; component: string }
  | { code: 'hard-link'; archivePath: string; declarationSite: string; sourcePath: string; links: number }
  | { code: 'escapes-root'; archivePath: string; declarationSite: string; sourcePath: string; resolved: string }
  | { code: 'resolved-source-alias'; archivePath: string; declarationSite: string; collidesWith: string }
  | { code: 'unreadable'; archivePath: string; declarationSite: string; sourcePath: string }

export type LoadSupplementarySourcesResult =
  | { ok: true; files: LoadedSupplementaryFile[] }
  | { ok: false; failures: SupplementarySourceFailure[] }

/**
 * The declaration site an archive-plan entry originated from, for failure
 * attribution. Skill companions are declared on their owning skill's `files`
 * array; archive-only files are declared in top-level `files`.
 */
function declarationSiteFor(entry: Extract<ArchivePlanEntry, { kind: 'skill-companion' | 'archive-only' }>): string {
  return entry.kind === 'skill-companion' ? `skills.${entry.skill}.files` : 'files'
}

/**
 * Load and validate every supplementary source declared by the archive plan.
 *
 * `rootDir` is the facet root; `plan` is the full tagged entry list from
 * `planArchiveEntries`. Manifest and primary-asset entries are ignored here.
 * Returns loaded bytes for every supplementary entry, or the complete set of
 * structured failures. Collects all failures (does not stop at the first) so
 * a build reports every bad declaration in one pass.
 */
export async function loadSupplementarySources(
  rootDir: string,
  plan: readonly ArchivePlanEntry[],
): Promise<LoadSupplementarySourcesResult> {
  const supplementary = plan.filter(
    (e): e is Extract<ArchivePlanEntry, { kind: 'skill-companion' | 'archive-only' }> =>
      e.kind === 'skill-companion' || e.kind === 'archive-only',
  )

  const failures: SupplementarySourceFailure[] = []
  const loaded: LoadedSupplementaryFile[] = []

  // Realpath the facet root once so containment comparisons are stable under
  // symlinked temp dirs (macOS `/var` → `/private/var`).
  let rootReal: string
  try {
    rootReal = await realpath(rootDir)
  } catch {
    // A build cannot proceed without a resolvable root; surface every
    // declared supplementary path as unreadable rather than throwing.
    for (const entry of supplementary) {
      failures.push({
        code: 'unreadable',
        archivePath: entry.path,
        declarationSite: declarationSiteFor(entry),
        sourcePath: join(rootDir, entry.path),
      })
    }
    return { ok: false, failures }
  }
  const rootPrefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`

  /** Maps `${dev}:${ino}` → the first archivePath that resolved to it. */
  const identityByKey = new Map<string, string>()

  for (const entry of supplementary) {
    const declarationSite = declarationSiteFor(entry)
    const sourcePath = join(rootDir, entry.path)

    // 1. Reject a symlink anywhere in the parent chain from the facet root
    // down to the file's parent. `realpath` alone would silently *follow* a
    // parent symlink that stays inside the root; walking with `lstat` rejects
    // it. Only existing components are checked — a missing parent surfaces as
    // a `missing` target below.
    const parentSymlink = await firstSymlinkedParent(rootReal, dirname(sourcePath))
    if (parentSymlink !== null) {
      failures.push({
        code: 'symlinked-parent',
        archivePath: entry.path,
        declarationSite,
        sourcePath,
        component: parentSymlink,
      })
      continue
    }

    // 2. lstat the final target (does NOT follow a final symlink).
    let stats: Awaited<ReturnType<typeof lstat>>
    try {
      stats = await lstat(sourcePath)
    } catch {
      failures.push({ code: 'missing', archivePath: entry.path, declarationSite, sourcePath })
      continue
    }
    if (stats.isSymbolicLink()) {
      failures.push({ code: 'not-regular-file', archivePath: entry.path, declarationSite, sourcePath, kind: 'symlink' })
      continue
    }
    if (stats.isDirectory()) {
      failures.push({
        code: 'not-regular-file',
        archivePath: entry.path,
        declarationSite,
        sourcePath,
        kind: 'directory',
      })
      continue
    }
    if (!stats.isFile()) {
      failures.push({ code: 'not-regular-file', archivePath: entry.path, declarationSite, sourcePath, kind: 'other' })
      continue
    }
    if (stats.nlink > 1) {
      failures.push({ code: 'hard-link', archivePath: entry.path, declarationSite, sourcePath, links: stats.nlink })
      continue
    }

    // 3. realpath containment — belt-and-suspenders after the parent walk,
    // catching a multi-hop escape the parent walk's single-level lstat cannot.
    let real: string
    try {
      real = await realpath(sourcePath)
    } catch {
      failures.push({ code: 'unreadable', archivePath: entry.path, declarationSite, sourcePath })
      continue
    }
    if (real !== rootReal && !real.startsWith(rootPrefix)) {
      failures.push({ code: 'escapes-root', archivePath: entry.path, declarationSite, sourcePath, resolved: real })
      continue
    }

    // 4. Resolved-source identity: two declarations pointing at one inode
    // are aliases the pure spelling-collision check cannot see. Keyed by
    // (dev, ino); the `hard-link` check above already rejects the common
    // in-tree case, but this catches a single file declared twice via
    // distinct spellings that resolve to the same source.
    const identityKey = `${stats.dev}:${stats.ino}`
    const collidesWith = identityByKey.get(identityKey)
    if (collidesWith !== undefined) {
      failures.push({ code: 'resolved-source-alias', archivePath: entry.path, declarationSite, collidesWith })
      continue
    }
    identityByKey.set(identityKey, entry.path)

    // 5. Read the same resolved path we validated. The bytes we hash are the
    // bytes we read, so a swap between validation and read produces a hash
    // the reviewer sees rather than a validated-but-unhashed file.
    let content: Uint8Array
    try {
      content = new Uint8Array(await readFile(real))
    } catch {
      failures.push({ code: 'unreadable', archivePath: entry.path, declarationSite, sourcePath })
      continue
    }

    loaded.push({ archivePath: entry.path, content })
  }

  if (failures.length > 0) {
    return { ok: false, failures }
  }
  return { ok: true, files: loaded }
}

/**
 * Assemble the complete, deterministically ordered archive-entry list
 * directly from the shared archive plan (design D3) — the single source of
 * truth for archive membership and ordering. Every planned entry is resolved
 * to its content by kind:
 *
 *   - `manifest`        → the exact embedded `facet.json` bytes,
 *   - `primary-asset`   → the resolved prompt text for that asset,
 *   - `skill-companion` → the loaded supplementary bytes,
 *   - `archive-only`    → the loaded supplementary bytes.
 *
 * The plan is already sorted lexicographically by path, so the resulting
 * entry list — and therefore the assembled tar — is deterministic regardless
 * of manifest declaration order. Binary and empty supplementary content pass
 * through verbatim as `Uint8Array`; primary content is passed through as-is.
 *
 * Preconditions (guaranteed by earlier pipeline stages): every primary asset
 * in the plan has a resolved prompt, and every supplementary entry has loaded
 * bytes. A missing lookup indicates a pipeline bug and is surfaced as a
 * thrown error rather than silently dropping an entry.
 */
export function collectArchiveEntriesFromPlan(
  plan: readonly ArchivePlanEntry[],
  manifestBytes: string,
  resolved: ResolvedFacetManifest,
  supplementaryFiles: readonly LoadedSupplementaryFile[],
): ArchiveEntry[] {
  const supplementaryByPath = new Map(supplementaryFiles.map((f) => [f.archivePath, f.content]))

  return plan.map((entry): ArchiveEntry => ({ path: entry.path, content: contentForEntry(entry) }))

  function contentForEntry(entry: ArchivePlanEntry): string | Uint8Array {
    switch (entry.kind) {
      case 'manifest':
        return manifestBytes
      case 'primary-asset': {
        const prompt = primaryPromptFor(resolved, entry)
        if (prompt === undefined) {
          throw new Error(`Archive plan references primary asset ${entry.path} with no resolved prompt`)
        }
        return prompt
      }
      case 'skill-companion':
      case 'archive-only': {
        const bytes = supplementaryByPath.get(entry.path)
        if (bytes === undefined) {
          throw new Error(`Archive plan references supplementary file ${entry.path} with no loaded bytes`)
        }
        return bytes
      }
      default: {
        const unreachable: never = entry
        return unreachable
      }
    }
  }
}

/** Look up a primary asset's resolved prompt text by its plan entry. */
function primaryPromptFor(
  resolved: ResolvedFacetManifest,
  entry: Extract<ArchivePlanEntry, { kind: 'primary-asset' }>,
): string | undefined {
  switch (entry.assetType) {
    case 'skill':
      return resolved.skills?.[entry.name]?.prompt
    case 'agent':
      return resolved.agents?.[entry.name]?.prompt
    case 'command':
      return resolved.commands?.[entry.name]?.prompt
  }
}

/**
 * Translate a structured supplementary-source failure into the project-wide
 * `ValidationError` shape the build pipeline reports. The `code` is preserved
 * in the message so the class remains identifiable in rendered output, while
 * `path` carries the declaration site for field attribution.
 */
export function supplementarySourceFailureToValidationError(failure: SupplementarySourceFailure): ValidationError {
  switch (failure.code) {
    case 'missing':
      return {
        path: failure.declarationSite,
        message: `Declared file not found: ${failure.archivePath} (resolved to ${failure.sourcePath}).`,
        expected: 'an existing regular file',
        actual: 'file not found',
      }
    case 'not-regular-file':
      return {
        path: failure.declarationSite,
        message: `Declared file ${failure.archivePath} is a ${failure.kind}, not a regular file.`,
        expected: 'a regular file',
        actual: failure.kind,
      }
    case 'symlinked-parent':
      return {
        path: failure.declarationSite,
        message: `Declared file ${failure.archivePath} resolves through a symlinked parent directory "${failure.component}". Links are not permitted in supplementary source paths.`,
        expected: 'no symlinked path components',
        actual: `symlinked component "${failure.component}"`,
      }
    case 'hard-link':
      return {
        path: failure.declarationSite,
        message: `Declared file ${failure.archivePath} is a hard link (${failure.links} links). Links are not permitted in supplementary source paths.`,
        expected: 'a regular file with a single link',
        actual: `hard link (${failure.links} links)`,
      }
    case 'escapes-root':
      return {
        path: failure.declarationSite,
        message: `Declared file ${failure.archivePath} resolves to ${failure.resolved}, outside the facet root.`,
        expected: 'a source inside the facet root',
        actual: 'a source outside the facet root',
      }
    case 'resolved-source-alias':
      return {
        path: failure.declarationSite,
        message: `Declared file ${failure.archivePath} resolves to the same source as ${failure.collidesWith}. Each declaration must reference a distinct file.`,
        expected: 'distinct source files',
        actual: 'two declarations sharing one source',
      }
    case 'unreadable':
      return {
        path: failure.declarationSite,
        message: `Declared file ${failure.archivePath} could not be read from ${failure.sourcePath}.`,
        expected: 'a readable regular file',
        actual: 'unreadable file',
      }
  }
}

/**
 * Walk every existing directory component from `rootReal` (exclusive) down to
 * and including `dir`, returning the first component that is a symlink, or
 * `null` if none are. Non-existent components are not symlinks (the missing
 * target is reported separately), so a lstat failure ends the walk cleanly.
 */
async function firstSymlinkedParent(rootReal: string, dir: string): Promise<string | null> {
  // Only inspect components at or below the root. `dir` may equal the root
  // (a top-level file's parent), in which case there is nothing to walk.
  const rootPrefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`
  if (dir === rootReal) return null
  if (!dir.startsWith(rootPrefix)) {
    // The parent isn't under the (realpathed) root at all — containment will
    // reject the target; nothing symlink-specific to report here.
    return null
  }

  const relative = dir.slice(rootPrefix.length)
  const components = relative.split(sep).filter((c) => c.length > 0)

  let current = rootReal
  for (const component of components) {
    current = join(current, component)
    let stats: Awaited<ReturnType<typeof lstat>>
    try {
      stats = await lstat(current)
    } catch {
      // A missing intermediate component isn't a symlink; stop walking and
      // let the target lstat report `missing`.
      return null
    }
    if (stats.isSymbolicLink()) {
      return component
    }
  }
  return null
}
