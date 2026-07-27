import type { AssetType, ValidationError } from '@agent-facets/common'
import {
  ASSET_DIRECTORY,
  canonicalPrimaryPath,
  portableCollisionKey,
  SKILL_PRIMARY_FILE,
  skillRootPath,
} from '../materialization/identity.ts'

/**
 * Archive plan — the single shared derivation of archive membership and
 * entry classification from a facet manifest (design D3).
 *
 * The embedded `facet.json` is the sole source of truth for which paths an
 * archive contains and what each path *is*. Build collection, per-entry
 * hashing, archive verification, parsed-archive results, and installation
 * all consume this one operation so their membership sets cannot drift
 * apart. No stage maintains its own allowlist.
 *
 * The operation is pure: it takes manifest-shaped data and returns either a
 * deterministic (lexicographically sorted) tagged entry list or structured
 * validation failures. It never touches disk — build-time source checks
 * (regular files only, resolved link identity) are an engine concern layered
 * on top.
 */

/** Distinct failure classes for archive-plan validation (design D7). */
export type ArchivePlanErrorCode =
  // Per-path grammar
  | 'path-empty'
  | 'path-traversal'
  | 'path-absolute'
  | 'path-backslash'
  | 'path-control-byte'
  | 'path-empty-segment'
  | 'path-forbidden-character'
  | 'path-reserved-device-name'
  | 'path-trailing-dot-or-space'
  // Declaration-site rules
  | 'site-top-level-under-skills'
  | 'site-skill-companion-is-primary'
  | 'reserved-root-manifest'
  // Whole-set collision rules
  | 'collision-duplicate'
  | 'collision-unicode-alias'
  | 'collision-case-fold'
  | 'collision-prefix'
  | 'collision-primary-path'

/**
 * A structured archive-plan failure. Extends the project-wide
 * `ValidationError` with a machine-readable failure-class discriminator so
 * every D7 failure class is distinguishable without parsing messages.
 */
export interface ArchivePlanError extends ValidationError {
  code: ArchivePlanErrorCode
}

/**
 * One planned inner-archive entry, tagged with its classification. Every
 * entry is exactly one of these — classification via optional fields is
 * prohibited (design D6).
 */
export type ArchivePlanEntry =
  | { kind: 'manifest'; path: 'facet.json' }
  | { kind: 'primary-asset'; path: string; assetType: AssetType; name: string }
  | { kind: 'skill-companion'; path: string; skill: string }
  | { kind: 'archive-only'; path: string }

export type ArchivePlanResult = { ok: true; data: ArchivePlanEntry[] } | { ok: false; errors: ArchivePlanError[] }

/**
 * The minimal manifest shape the plan derivation needs. Structural (rather
 * than importing `FacetManifest`) so the facet-manifest schema's narrow can
 * call into this module without an import cycle, and so any
 * manifest-version's validated data can be planned.
 */
export interface ArchivePlanInput {
  skills?: Record<string, { files?: string[] }> | undefined
  agents?: Record<string, unknown> | undefined
  commands?: Record<string, unknown> | undefined
  files?: string[] | undefined
}

/** The reserved root path of the embedded manifest. */
const MANIFEST_PATH = 'facet.json'

/** Characters forbidden in any path segment for filesystem portability. */
const FORBIDDEN_CHARS_RE = /[<>:"|?*]/

/** Control bytes (0x00–0x1F) are never valid in portable paths. NUL included. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control bytes is the point
const CONTROL_BYTES_RE = /[\u0000-\u001f]/

/** Windows drive prefix (`C:`) or URL-like prefix (`scheme://`). */
const DRIVE_PREFIX_RE = /^[A-Za-z]:/
const URL_PREFIX_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//

/** Windows-reserved device names, matched case-insensitively per segment. */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

function planError(
  code: ArchivePlanErrorCode,
  declarationSite: string,
  path: string,
  message: string,
  expected: string,
): ArchivePlanError {
  return {
    code,
    path: declarationSite,
    message,
    expected,
    actual: path === '' ? 'empty path' : `"${path}"`,
  }
}

/**
 * Validate one declared supplementary path against the portable path grammar
 * (design D7). Returns every failure class the path violates, attributed to
 * `declarationSite` (e.g. `files` or `skills.review.files`).
 */
export function validateSupplementaryPath(declared: string, declarationSite: string): ArchivePlanError[] {
  const errors: ArchivePlanError[] = []
  const fail = (code: ArchivePlanErrorCode, message: string, expected: string) => {
    errors.push(planError(code, declarationSite, declared, message, expected))
  }

  if (declared === '') {
    fail('path-empty', 'Declared path must not be empty.', 'a non-empty relative path')
    return errors
  }
  if (CONTROL_BYTES_RE.test(declared)) {
    fail('path-control-byte', `Declared path "${declared}" contains control bytes.`, 'no control bytes (0x00-0x1F)')
    // Control bytes make further reporting unreliable; stop here.
    return errors
  }
  if (declared.includes('\\')) {
    fail(
      'path-backslash',
      `Declared path "${declared}" contains a backslash. Use forward slashes.`,
      'forward-slash separated relative path',
    )
  }
  if (declared.startsWith('/')) {
    fail('path-absolute', `Declared path "${declared}" is absolute. Paths must be relative.`, 'a relative path')
  } else if (DRIVE_PREFIX_RE.test(declared) || URL_PREFIX_RE.test(declared)) {
    fail(
      'path-absolute',
      `Declared path "${declared}" has a drive or URL-like prefix. Paths must be relative.`,
      'a relative path',
    )
  }

  const segments = declared.split('/')
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string
    if (segment === '..') {
      fail('path-traversal', `Declared path "${declared}" contains a ".." segment.`, 'no parent-directory traversal')
      continue
    }
    if (segment === '' || segment === '.') {
      // A leading slash was already reported as absolute; don't double-report
      // its empty first segment.
      if (segment === '' && i === 0 && declared.startsWith('/')) continue
      fail(
        'path-empty-segment',
        `Declared path "${declared}" contains an empty or "." segment.`,
        'canonical path segments',
      )
      continue
    }
    if (FORBIDDEN_CHARS_RE.test(segment)) {
      fail(
        'path-forbidden-character',
        `Declared path "${declared}" contains a character that is not portable across filesystems (< > : " | ? *).`,
        'segments without < > : " | ? *',
      )
    }
    const base = segment.includes('.') ? segment.slice(0, segment.indexOf('.')) : segment
    if (RESERVED_DEVICE_NAMES.has(segment.toLowerCase()) || RESERVED_DEVICE_NAMES.has(base.toLowerCase())) {
      fail(
        'path-reserved-device-name',
        `Declared path "${declared}" contains segment "${segment}", a reserved device name on Windows.`,
        'no Windows-reserved device-name segments',
      )
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      fail(
        'path-trailing-dot-or-space',
        `Declared path "${declared}" contains segment "${segment}" ending in a dot or space, which is not portable.`,
        'no segments ending in a dot or space',
      )
    }
  }

  return errors
}

interface PlannedPath {
  entry: ArchivePlanEntry
  /** Where this path was declared, for error attribution. */
  declarationSite: string
}

/**
 * Derive the tagged archive plan from manifest data (design D3), enforcing
 * the complete D7 path-safety and collision grammar over the whole planned
 * entry set.
 *
 * Preconditions: asset names are assumed to have passed their manifest
 * schema's name grammar. Declared supplementary paths are validated here in
 * full, so callers get identical results whether the manifest came from an
 * authoring tree or an embedded archive entry.
 */
export function planArchiveEntries(manifest: ArchivePlanInput): ArchivePlanResult {
  const errors: ArchivePlanError[] = []
  const planned: PlannedPath[] = [{ entry: { kind: 'manifest', path: MANIFEST_PATH }, declarationSite: '' }]

  // 1. Conventional primary-asset paths, derived from manifest keys. Both
  //    the path and the declaration site come from the shared authored-path
  //    derivation so this module cannot drift from the identity helpers the
  //    lockfile, receipt, and materialization planner use.
  const assetGroups: [AssetType, Record<string, unknown> | undefined][] = [
    ['skill', manifest.skills],
    ['agent', manifest.agents],
    ['command', manifest.commands],
  ]
  for (const [assetType, record] of assetGroups) {
    if (!record) continue
    for (const name of Object.keys(record)) {
      planned.push({
        entry: { kind: 'primary-asset', path: canonicalPrimaryPath(assetType, name), assetType, name },
        declarationSite: `${ASSET_DIRECTORY[assetType]}.${name}`,
      })
    }
  }

  // 2. Skill companions: declared per skill, relative to the skill directory.
  if (manifest.skills) {
    for (const [skillName, skill] of Object.entries(manifest.skills)) {
      if (!skill.files) continue
      const site = `${ASSET_DIRECTORY.skill}.${skillName}.files`
      for (const declared of skill.files) {
        const pathErrors = validateSupplementaryPath(declared, site)
        if (pathErrors.length > 0) {
          errors.push(...pathErrors)
          continue
        }
        if (declared === SKILL_PRIMARY_FILE) {
          errors.push(
            planError(
              'site-skill-companion-is-primary',
              site,
              declared,
              `Skill "${skillName}" declares "${SKILL_PRIMARY_FILE}" as a companion file. ${SKILL_PRIMARY_FILE} is the skill's primary file and is always included.`,
              `companion paths other than ${SKILL_PRIMARY_FILE}`,
            ),
          )
          continue
        }
        planned.push({
          entry: { kind: 'skill-companion', path: `${skillRootPath(skillName)}${declared}`, skill: skillName },
          declarationSite: site,
        })
      }
    }
  }

  // 3. Archive-only supplementary files: top-level, repo-relative.
  if (manifest.files) {
    const site = 'files'
    for (const declared of manifest.files) {
      const pathErrors = validateSupplementaryPath(declared, site)
      if (pathErrors.length > 0) {
        errors.push(...pathErrors)
        continue
      }
      if (declared === MANIFEST_PATH) {
        errors.push(
          planError(
            'reserved-root-manifest',
            site,
            declared,
            `The root path "${MANIFEST_PATH}" is the embedded manifest itself and cannot be declared. The basename may be used below another directory.`,
            `paths other than root ${MANIFEST_PATH}`,
          ),
        )
        continue
      }
      if (declared.split('/')[0] === ASSET_DIRECTORY.skill) {
        errors.push(
          planError(
            'site-top-level-under-skills',
            site,
            declared,
            `Top-level files must not resolve under ${ASSET_DIRECTORY.skill}/. Declare "${declared}" in the owning skill's files array instead.`,
            `top-level paths outside ${ASSET_DIRECTORY.skill}/`,
          ),
        )
        continue
      }
      planned.push({ entry: { kind: 'archive-only', path: declared }, declarationSite: site })
    }
  }

  // 4. Whole-set collision detection: exact duplicates, Unicode-normalization
  // aliases, portable case-fold aliases, and file/directory prefix conflicts.
  // Primary paths participate so supplementary-vs-primary collisions are
  // caught and reported with their own class.
  const byKey = new Map<string, PlannedPath>()
  const accepted: PlannedPath[] = []
  for (const candidate of planned) {
    const key = portableCollisionKey(candidate.entry.path)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, candidate)
      accepted.push(candidate)
      continue
    }
    const supplementaryVsPrimary =
      existing.entry.kind === 'manifest' ||
      existing.entry.kind === 'primary-asset' ||
      candidate.entry.kind === 'manifest' ||
      candidate.entry.kind === 'primary-asset'
    const code: ArchivePlanErrorCode =
      supplementaryVsPrimary && candidate.entry.kind !== existing.entry.kind
        ? 'collision-primary-path'
        : candidate.entry.path === existing.entry.path
          ? 'collision-duplicate'
          : candidate.entry.path.normalize('NFC') === existing.entry.path.normalize('NFC')
            ? 'collision-unicode-alias'
            : 'collision-case-fold'
    errors.push(
      planError(
        code,
        candidate.declarationSite,
        candidate.entry.path,
        `Path "${candidate.entry.path}" collides with "${existing.entry.path}" (declared at ${existing.declarationSite || 'the manifest root'}) on supported filesystems.`,
        'collision-free archive paths',
      ),
    )
  }

  // File/directory prefix conflicts: a planned file path that is also a
  // directory prefix of another planned path cannot coexist on disk.
  const directoryKeys = new Map<string, PlannedPath>()
  for (const candidate of accepted) {
    const segments = candidate.entry.path.split('/')
    for (let i = 1; i < segments.length; i++) {
      directoryKeys.set(portableCollisionKey(segments.slice(0, i).join('/')), candidate)
    }
  }
  for (const candidate of accepted) {
    const conflict = directoryKeys.get(portableCollisionKey(candidate.entry.path))
    if (conflict) {
      errors.push(
        planError(
          'collision-prefix',
          candidate.declarationSite,
          candidate.entry.path,
          `Path "${candidate.entry.path}" is a file but also a parent directory of "${conflict.entry.path}". A path cannot be both.`,
          'no file/directory prefix conflicts',
        ),
      )
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const entries = accepted.map((p) => p.entry)
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { ok: true, data: entries }
}
