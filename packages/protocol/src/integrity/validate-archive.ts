import { type AssetType, type ValidationError, validateAssetName } from '@agent-facets/common'
import { planArchiveEntries } from '../build/archive-plan.ts'
import { computeContentHash, INNER_ARCHIVE_NAME, parseFacetArchive, parseInnerArchive } from '../build/content-hash.ts'
import { detectNamingCollisions } from '../build/detect-collisions.ts'
import { validateRawTarEntries } from '../build/tar-headers.ts'
import { validateContentFiles } from '../build/validate-content.ts'
import { validateCompactFacets } from '../build/validate-facets.ts'
import {
  FACET_MANIFEST_FILE,
  resolvePromptsFromMap,
  validateFacetManifest,
  validateLegacyFacetManifest,
} from '../loaders/facet.ts'
import type { CurrentBuildManifest, LegacyBuildManifest } from '../schemas/build-manifest.ts'
import { FACET_ARCHIVE_VERSION, LEGACY_FACET_ARCHIVE_VERSION } from '../schemas/build-manifest.ts'
import type { FacetManifest } from '../schemas/facet-manifest.ts'
import type { LegacyFacetManifest } from '../schemas/facet-manifest-legacy.ts'
import type { AssetIntegrityFailure, FacetIntegrityFailure } from './types.ts'
import { verifyHash } from './verify.ts'

/**
 * Result of the caller's decompression callback for the inner archive.
 *
 *   - `{ ok: true; bytes }` — successful gunzip; `bytes` are the
 *     uncompressed inner tar.
 *   - `{ ok: false; reason: 'too-large' }` — the caller's policy refused
 *     to decompress further because the inflated output exceeded the
 *     caller's cap. The registry uses this for gzip-bomb defense.
 *   - `{ ok: false; reason: 'corrupt' }` — the bytes were not valid gzip
 *     (inflate error, truncated stream). Returned by any consumer.
 */
export type GunzipResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too-large' | 'corrupt' }

/**
 * Caller-supplied async gunzip required by `validateFacetArchive`.
 *
 * The callback MUST NOT throw on malformed input — translate inflate
 * errors to `{ ok: false, reason: 'corrupt' }`. The injection keeps
 * protocol pure: protocol does no compression or decompression itself,
 * and each consumer applies whatever decompression policy fits its
 * threat model (the registry caps size; the CLI does not).
 */
export type GunzipFn = (innerGzBytes: Uint8Array) => Promise<GunzipResult>

/**
 * A single verified file from the inner archive: in-archive path, raw
 * uncompressed bytes, and the recomputed content hash already confirmed to
 * equal the version-selected hash map's value for that path.
 */
export interface VerifiedAsset {
  path: string
  bytes: Uint8Array
  hash: string
}

/**
 * One verified inner-archive entry of a current (`0.2`) archive, tagged
 * with its archive-plan classification (design D6). Supplementary content
 * stays opaque bytes; only primary assets carry decoded text eligible for
 * asset processing.
 */
export type VerifiedEntry =
  | { kind: 'manifest'; path: string; bytes: Uint8Array; hash: string }
  | {
      kind: 'primary-asset'
      path: string
      assetType: AssetType
      name: string
      bytes: Uint8Array
      text: string
      hash: string
    }
  | { kind: 'skill-companion'; path: string; skill: string; bytes: Uint8Array; hash: string }
  | { kind: 'archive-only'; path: string; bytes: Uint8Array; hash: string }

/**
 * The fully verified contents of a built `.facet`, tagged by exact archive
 * format version so consumers dispatch exhaustively (design D4/D6).
 *
 *   - Legacy `0.1` archives keep their flat `assets` list (identical to the
 *     pre-`0.2` verifier output).
 *   - Current `0.2` archives expose classified entries: primary assets as
 *     text, skill companions grouped with their owning skill via the
 *     `skill` tag, and archive-only supplementary files as opaque bytes.
 */
export type VerifiedFacetArchive =
  | {
      archiveVersion: typeof LEGACY_FACET_ARCHIVE_VERSION
      buildManifest: LegacyBuildManifest
      facetManifest: LegacyFacetManifest
      assets: VerifiedAsset[]
    }
  | {
      archiveVersion: typeof FACET_ARCHIVE_VERSION
      buildManifest: CurrentBuildManifest
      facetManifest: FacetManifest
      entries: VerifiedEntry[]
    }

/**
 * Uniform extraction view over a verified archive: every inner-archive
 * file with its bytes and verified hash, regardless of format version or
 * classification. Consumers that persist archives to disk (registry
 * download, cache staging) use this instead of branching per version.
 */
export function listVerifiedFiles(archive: VerifiedFacetArchive): VerifiedAsset[] {
  if (archive.archiveVersion === LEGACY_FACET_ARCHIVE_VERSION) {
    return archive.assets
  }
  return archive.entries.map((entry) => ({ path: entry.path, bytes: entry.bytes, hash: entry.hash }))
}

/**
 * The version-selected per-entry hash map of a verified archive
 * (`assets` for legacy `0.1`, `files` for current `0.2`).
 */
export function verifiedFileHashes(archive: VerifiedFacetArchive): Record<string, string> {
  return archive.archiveVersion === LEGACY_FACET_ARCHIVE_VERSION
    ? archive.buildManifest.assets
    : archive.buildManifest.files
}

/**
 * Structured failure data for archive verification. Every expected failure
 * mode is a tagged variant — no thrown errors escape the contract.
 */
export type ArchiveVerificationFailure =
  /** The outer container is malformed (raw headers, entry set, unparseable tar). */
  | { code: 'container'; errors: ValidationError[] }
  /** The build manifest is not valid JSON. */
  | { code: 'invalid-json'; errors: ValidationError[] }
  /** A JSON artifact contains duplicate object member names. */
  | { code: 'duplicate-members'; errors: ValidationError[] }
  /** The archive declares an unsupported `facetVersion`. Carries observed + supported. */
  | { code: 'unsupported-facet-version'; observed: number | undefined; supported: readonly number[] }
  /** The build manifest declared a supported version but violates that version's schema. */
  | { code: 'schema-violation'; facetVersion: number; errors: ValidationError[] }
  /** The caller-supplied decompressor refused the inner archive. */
  | { code: 'decompression'; reason: 'too-large' | 'corrupt' }
  /** The recomputed inner-tar hash does not match the manifest's integrity (check C). */
  | { code: 'integrity'; failure: FacetIntegrityFailure }
  /** One or more entries failed their recorded per-entry hash. Exact paths included. */
  | { code: 'entry-integrity'; failures: AssetIntegrityFailure[] }
  /** Membership, path-safety, manifest, or content-rule violations. */
  | { code: 'validation'; errors: ValidationError[] }

export type ValidateFacetArchiveResult =
  | { ok: true; data: VerifiedFacetArchive }
  | { ok: false; failure: ArchiveVerificationFailure }

/**
 * Sentinel facet label used in integrity failures raised before the
 * embedded manifest (and therefore the facet name) has been validated.
 */
const ARCHIVE_FACET_LABEL = '<archive>'

/**
 * Verify a built `.facet` end-to-end — the single archive-verification
 * operation any facet-compatible system uses before trusting `.facet`
 * bytes (registry uploads, CLI publish, install downloads).
 *
 * Pipeline (design D5; each step short-circuits to a structured failure;
 * no step throws):
 *
 *   1. Strict outer-container parse (`parseFacetArchive`): raw tar-header
 *      validation before either entry is selected, exact two-entry set,
 *      versioned build-manifest parse with exact `facetVersion` dispatch
 *      and duplicate-JSON-member rejection. Unsupported versions surface
 *      as structured `unsupported-facet-version` failures; a malformed
 *      current manifest is NEVER reinterpreted under the legacy schema.
 *   2. Decompress the inner archive via the injected `gunzip`.
 *   3. Verify the recomputed inner-tar hash equals the manifest's
 *      `integrity` (check `'C'`).
 *   4. Raw-header validation of the inner tar (duplicates, portable
 *      aliases, non-regular entries, non-canonical paths) before any
 *      path-keyed structure exists — for BOTH format versions.
 *   5. Version-dispatched content verification:
 *        - `0.1` (legacy, frozen): per-asset hash reconciliation against
 *          `assets`, legacy facet-manifest schema, legacy conventional
 *          outer-exclusivity allowlist, legacy content rules.
 *        - `0.2` (current): embedded manifest validated under current
 *          rules; expected membership derived from the shared archive
 *          plan (design D3); exact three-way set equality among expected
 *          paths, observed entries, and the `files` hash-map keys; every
 *          entry byte-verified; entries returned as tagged data with
 *          supplementary content kept as opaque bytes.
 */
export async function validateFacetArchive(
  outerTarBytes: Uint8Array,
  options: { gunzip: GunzipFn },
): Promise<ValidateFacetArchiveResult> {
  // Step 1: strict outer-container parse + versioned build-manifest parse
  const outerResult = parseFacetArchive(outerTarBytes)
  if (!outerResult.ok) {
    return { ok: false, failure: outerResult.failure }
  }
  const { manifest: parsedManifest, innerArchiveBytes } = outerResult.data

  // Step 2: decompress inner archive via injected gunzip
  const gunzipResult = await options.gunzip(innerArchiveBytes)
  if (!gunzipResult.ok) {
    return { ok: false, failure: { code: 'decompression', reason: gunzipResult.reason } }
  }
  const innerTarBytes = gunzipResult.bytes

  // Step 3: verify recomputed content hash equals build manifest's integrity
  const computedIntegrity = computeContentHash(innerTarBytes)
  const integrityResult = verifyHash(ARCHIVE_FACET_LABEL, 'C', parsedManifest.manifest.integrity, computedIntegrity)
  if (!integrityResult.ok) {
    // verifyHash only produces facet-kind failures for check 'C'.
    if (integrityResult.failure.kind !== 'facet') {
      return {
        ok: false,
        failure: {
          code: 'integrity',
          failure: {
            kind: 'facet',
            facet: ARCHIVE_FACET_LABEL,
            check: 'C',
            expected: parsedManifest.manifest.integrity,
            observed: computedIntegrity,
          },
        },
      }
    }
    return { ok: false, failure: { code: 'integrity', failure: integrityResult.failure } }
  }

  // Step 4: raw-header validation of the inner tar, before any path-keyed
  // structure. Applies to both versions — a canonical legacy archive can
  // never contain duplicates, aliases, or non-regular entries either.
  //
  // Canonical ordering is enforced here (but NOT on the outer container):
  // the cache/registry recompute path rebuilds the inner tar from
  // lexicographically sorted entries, so an out-of-order archive that is
  // otherwise hash-correct would pass verification but fail installation
  // when the reconstructed tar hashes differently. Rejecting non-canonical
  // order keeps "verified" and "installable" the same set.
  const rawInner = validateRawTarEntries(innerTarBytes, INNER_ARCHIVE_NAME, { enforceCanonicalOrder: true })
  if (!rawInner.ok) {
    return { ok: false, failure: { code: 'validation', errors: rawInner.errors } }
  }

  // Parse the (now raw-validated) inner tar into data-bearing entries.
  const innerResult = parseInnerArchive(innerTarBytes)
  if (!innerResult.ok) {
    return {
      ok: false,
      failure: { code: 'validation', errors: innerResult.errors.map((e) => ({ ...e, path: INNER_ARCHIVE_NAME })) },
    }
  }
  // Raw validation guarantees unique canonical paths — this map is lossless.
  const bytesByPath = new Map<string, Uint8Array>()
  for (const entry of innerResult.entries) {
    const bytes: Uint8Array =
      entry.data instanceof Uint8Array ? entry.data : entry.data ? new Uint8Array(entry.data) : new Uint8Array(0)
    bytesByPath.set(entry.name, bytes)
  }

  // Step 5: version-dispatched content verification. No cross-version
  // fallback: a malformed current archive fails under current rules.
  if (parsedManifest.facetVersion === LEGACY_FACET_ARCHIVE_VERSION) {
    return verifyLegacyContents(parsedManifest.manifest, bytesByPath)
  }
  return verifyCurrentContents(parsedManifest.manifest, bytesByPath)
}

/**
 * Legacy `0.1` content verification — frozen at the pre-`0.2` rules
 * (multi-segment names, conventional-path outer exclusivity, per-asset
 * `assets` hash map, empty-content rule for every entry).
 */
function verifyLegacyContents(
  buildManifest: LegacyBuildManifest,
  bytesByPath: Map<string, Uint8Array>,
): ValidateFacetArchiveResult {
  // Legacy Step 4b: weak path-safety guard over the build manifest's asset
  // keys (entry names are already raw-validated as canonical).
  const pathSafetyErrors: ValidationError[] = []
  for (const key of Object.keys(buildManifest.assets)) {
    const check = validateAssetName(key)
    if (!check.ok) {
      pathSafetyErrors.push({
        path: key,
        message: `Build manifest asset key fails path safety validation: ${check.reason}`,
        expected: 'safe relative path',
        actual: key,
      })
    }
  }
  if (pathSafetyErrors.length > 0) {
    return { ok: false, failure: { code: 'validation', errors: pathSafetyErrors } }
  }

  // Legacy Step 5: per-asset hash reconciliation, both directions.
  const membershipErrors: ValidationError[] = []
  const hashFailures: AssetIntegrityFailure[] = []
  const verifiedAssets: VerifiedAsset[] = []
  for (const [path, bytes] of bytesByPath) {
    const expectedHash = buildManifest.assets[path]
    if (expectedHash === undefined) {
      membershipErrors.push({
        path,
        message: `Inner archive contains an undeclared entry: not present in build manifest's assets map.`,
        expected: 'declared in build manifest',
        actual: 'undeclared entry',
      })
      continue
    }
    const observedHash = computeContentHash(bytes)
    if (expectedHash !== observedHash) {
      hashFailures.push({
        kind: 'asset',
        facet: ARCHIVE_FACET_LABEL,
        path,
        expected: expectedHash,
        observed: observedHash,
      })
      continue
    }
    verifiedAssets.push({ path, bytes, hash: observedHash })
  }
  for (const declared of Object.keys(buildManifest.assets)) {
    if (!bytesByPath.has(declared)) {
      membershipErrors.push({
        path: declared,
        message: `Asset declared in the build manifest is missing from the inner archive.`,
        expected: 'present in inner archive',
        actual: 'missing',
      })
    }
  }
  if (membershipErrors.length > 0) {
    return { ok: false, failure: { code: 'validation', errors: membershipErrors } }
  }
  if (hashFailures.length > 0) {
    return { ok: false, failure: { code: 'entry-integrity', failures: hashFailures } }
  }

  // Legacy Step 6: embedded facet.json under the frozen legacy schema.
  const manifestBytes = bytesByPath.get(FACET_MANIFEST_FILE)
  if (manifestBytes === undefined) {
    return {
      ok: false,
      failure: {
        code: 'validation',
        errors: [
          {
            path: FACET_MANIFEST_FILE,
            message: `Inner archive is missing the embedded ${FACET_MANIFEST_FILE} entry.`,
            expected: `${FACET_MANIFEST_FILE} present in inner archive`,
            actual: 'missing',
          },
        ],
      },
    }
  }
  const facetResult = validateLegacyFacetManifest(manifestBytes)
  if (!facetResult.ok) {
    return {
      ok: false,
      failure: {
        code: 'validation',
        errors: facetResult.errors.map((e) => ({
          ...e,
          path: e.path ? `${FACET_MANIFEST_FILE}.${e.path}` : FACET_MANIFEST_FILE,
        })),
      },
    }
  }
  const facetManifest = facetResult.data

  // Legacy Step 6b: outer-exclusivity against the conventional-path
  // allowlist derived from the embedded facet.json (the trust root). The
  // build manifest is attacker-controlled, so Step 5's "declared in build
  // manifest" check is insufficient — extra files landing on disk at
  // install time would enable supply-chain code execution.
  const allowedPaths = new Set<string>([FACET_MANIFEST_FILE])
  if (facetManifest.skills) {
    for (const name of Object.keys(facetManifest.skills)) {
      allowedPaths.add(`skills/${name}/SKILL.md`)
    }
  }
  if (facetManifest.agents) {
    for (const name of Object.keys(facetManifest.agents)) {
      allowedPaths.add(`agents/${name}.md`)
    }
  }
  if (facetManifest.commands) {
    for (const name of Object.keys(facetManifest.commands)) {
      allowedPaths.add(`commands/${name}.md`)
    }
  }
  const extraPaths = verifiedAssets.filter((a) => !allowedPaths.has(a.path))
  if (extraPaths.length > 0) {
    return {
      ok: false,
      failure: {
        code: 'validation',
        errors: extraPaths.map((a) => ({
          path: a.path,
          message: `Inner archive contains a file not declared by ${FACET_MANIFEST_FILE}. Only conventional asset paths (skills, agents, commands) and ${FACET_MANIFEST_FILE} are permitted.`,
          expected: 'path derivable from facet.json',
          actual: 'undeclared extra file',
        })),
      },
    }
  }

  // Legacy Step 7: reconstruct ResolvedFacetManifest and run build validators.
  const contentByPath: Record<string, string> = {}
  const decoder = new TextDecoder()
  for (const asset of verifiedAssets) {
    contentByPath[asset.path] = decoder.decode(asset.bytes)
  }
  const resolvedResult = resolvePromptsFromMap(facetManifest, contentByPath)
  if (!resolvedResult.ok) {
    return { ok: false, failure: { code: 'validation', errors: resolvedResult.errors } }
  }
  const ruleErrors = [
    ...validateContentFiles(resolvedResult.data),
    ...detectNamingCollisions(facetManifest),
    ...validateCompactFacets(facetManifest),
  ]
  if (ruleErrors.length > 0) {
    return { ok: false, failure: { code: 'validation', errors: ruleErrors } }
  }

  return {
    ok: true,
    data: {
      archiveVersion: LEGACY_FACET_ARCHIVE_VERSION,
      buildManifest,
      facetManifest,
      assets: verifiedAssets,
    },
  }
}

/**
 * Current `0.2` content verification: the embedded manifest is validated
 * under current rules, expected membership is derived from the shared
 * archive plan (design D3), and the expected set, observed set, and
 * `files` hash-map key set must be exactly equal before every entry is
 * byte-verified. The successful result carries tagged entries with
 * supplementary content kept as opaque bytes (design D6).
 */
function verifyCurrentContents(
  buildManifest: CurrentBuildManifest,
  bytesByPath: Map<string, Uint8Array>,
): ValidateFacetArchiveResult {
  // Embedded facet.json under the current schema (includes duplicate-JSON-
  // member rejection, single-segment names, shared skill/command namespace,
  // and archive-plan-backed declaration validation via the schema narrow).
  const manifestBytes = bytesByPath.get(FACET_MANIFEST_FILE)
  if (manifestBytes === undefined) {
    return {
      ok: false,
      failure: {
        code: 'validation',
        errors: [
          {
            path: FACET_MANIFEST_FILE,
            message: `Inner archive is missing the embedded ${FACET_MANIFEST_FILE} entry.`,
            expected: `${FACET_MANIFEST_FILE} present in inner archive`,
            actual: 'missing',
          },
        ],
      },
    }
  }
  const facetResult = validateFacetManifest(manifestBytes)
  if (!facetResult.ok) {
    return {
      ok: false,
      failure: {
        code: 'validation',
        errors: facetResult.errors.map((e) => ({
          ...e,
          path: e.path ? `${FACET_MANIFEST_FILE}.${e.path}` : FACET_MANIFEST_FILE,
        })),
      },
    }
  }
  const facetManifest = facetResult.data

  // Expected membership comes from the shared archive plan — NEVER from
  // the build manifest, which is attacker-controlled (design D3/D5).
  const planResult = planArchiveEntries(facetManifest)
  if (!planResult.ok) {
    return {
      ok: false,
      failure: {
        code: 'validation',
        errors: planResult.errors.map((e) => ({
          ...e,
          path: e.path ? `${FACET_MANIFEST_FILE}.${e.path}` : FACET_MANIFEST_FILE,
        })),
      },
    }
  }
  const plan = planResult.data
  const expectedPaths = new Set(plan.map((entry) => entry.path))

  // Exact three-way set equality: expected (plan) == observed (inner tar)
  // == files hash-map keys. Undeclared extras, declared-but-missing
  // entries, and hash-map drift are each identified by exact path.
  const membershipErrors: ValidationError[] = []
  for (const path of bytesByPath.keys()) {
    if (!expectedPaths.has(path)) {
      membershipErrors.push({
        path,
        message: `Inner archive contains a file not derivable from ${FACET_MANIFEST_FILE}. Every entry must be a conventional asset path or an exact supplementary declaration.`,
        expected: 'path derivable from facet.json',
        actual: 'undeclared extra file',
      })
    }
  }
  for (const path of expectedPaths) {
    if (!bytesByPath.has(path)) {
      membershipErrors.push({
        path,
        message: `Entry derivable from ${FACET_MANIFEST_FILE} is missing from the inner archive.`,
        expected: 'present in inner archive',
        actual: 'missing',
      })
    }
  }
  const fileHashes = buildManifest.files
  for (const path of Object.keys(fileHashes)) {
    if (!expectedPaths.has(path)) {
      membershipErrors.push({
        path,
        message: `Build manifest records a hash for a path not derivable from ${FACET_MANIFEST_FILE}. A build-manifest record cannot expand archive membership.`,
        expected: 'hashes only for derivable paths',
        actual: 'hash for undeclared path',
      })
    }
  }
  for (const path of expectedPaths) {
    if (fileHashes[path] === undefined) {
      membershipErrors.push({
        path,
        message: `Build manifest is missing the required file hash for this entry.`,
        expected: 'one hash per expected path',
        actual: 'missing hash',
      })
    }
  }
  if (membershipErrors.length > 0) {
    return { ok: false, failure: { code: 'validation', errors: membershipErrors } }
  }

  // Byte-verify every entry against its recorded hash.
  const hashFailures: AssetIntegrityFailure[] = []
  const hashByPath = new Map<string, string>()
  for (const [path, bytes] of bytesByPath) {
    const observedHash = computeContentHash(bytes)
    const expectedHash = fileHashes[path] as string
    if (observedHash !== expectedHash) {
      hashFailures.push({
        kind: 'asset',
        facet: facetManifest.name,
        path,
        expected: expectedHash,
        observed: observedHash,
      })
      continue
    }
    hashByPath.set(path, observedHash)
  }
  if (hashFailures.length > 0) {
    return { ok: false, failure: { code: 'entry-integrity', failures: hashFailures } }
  }

  // Classify entries per the plan; decode ONLY primary assets as text.
  const decoder = new TextDecoder()
  const entries: VerifiedEntry[] = []
  const contentByPath: Record<string, string> = {}
  for (const planned of plan) {
    const bytes = bytesByPath.get(planned.path) as Uint8Array
    const hash = hashByPath.get(planned.path) as string
    switch (planned.kind) {
      case 'manifest':
        entries.push({ kind: 'manifest', path: planned.path, bytes, hash })
        break
      case 'primary-asset': {
        const text = decoder.decode(bytes)
        contentByPath[planned.path] = text
        entries.push({
          kind: 'primary-asset',
          path: planned.path,
          assetType: planned.assetType,
          name: planned.name,
          bytes,
          text,
          hash,
        })
        break
      }
      case 'skill-companion':
        entries.push({ kind: 'skill-companion', path: planned.path, skill: planned.skill, bytes, hash })
        break
      case 'archive-only':
        entries.push({ kind: 'archive-only', path: planned.path, bytes, hash })
        break
      default: {
        const unreachable: never = planned
        throw new Error(`unreachable archive-plan kind: ${JSON.stringify(unreachable)}`)
      }
    }
  }

  // Content rules apply to primary assets only (design D6): supplementary
  // files may be empty or binary and are never decoded here.
  const resolvedResult = resolvePromptsFromMap(facetManifest, contentByPath)
  if (!resolvedResult.ok) {
    return { ok: false, failure: { code: 'validation', errors: resolvedResult.errors } }
  }
  const ruleErrors = [...validateContentFiles(resolvedResult.data), ...validateCompactFacets(facetManifest)]
  if (ruleErrors.length > 0) {
    return { ok: false, failure: { code: 'validation', errors: ruleErrors } }
  }

  return {
    ok: true,
    data: {
      archiveVersion: FACET_ARCHIVE_VERSION,
      buildManifest,
      facetManifest,
      entries,
    },
  }
}
