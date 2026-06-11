/**
 * Identifies which facet-level check failed when an integrity
 * verification rejects. A facet-level check operates on the canonical
 * archive (the canonical tar of all assets, hashed as one blob).
 *
 *   - `'lockfile'`: the registry's current `expectedIntegrity` for a
 *     given (name, version) does not match the integrity recorded in
 *     the project's committed `facets.lock`. Highest-priority failure
 *     mode — the registry has retroactively redefined what a pinned
 *     version should hash to.
 *   - `'A'`: cache vs. registry metadata. Triggered on cache hit when
 *     the self-audited cached integrity (recomputed from the slot's
 *     content, not read from the sidecar) does not match the registry's
 *     published `contentFingerprint`. The cache audit has already
 *     verified content against the sidecar; this check anchors it
 *     against the registry.
 *   - `'B'`: archive manifest vs. registry metadata. Triggered when the
 *     downloaded archive's self-declared integrity does not match the
 *     metadata-API integrity. Detects metadata-vs-tarball split-brain.
 *   - `'C'`: computed content vs. archive manifest. Triggered when the
 *     archive's content hashes to a value other than what its own
 *     manifest claims. Detects tampered tarballs. Also reused by
 *     `cachePutVerified` when the caller's `computedIntegrity`
 *     disagrees with the build manifest's recorded `integrity`.
 *   - `'git'`: built artifact vs. lockfile integrity for a git source.
 *     Detects tag-move attacks (the symbolic ref now resolves to a
 *     different commit whose build hashes differently).
 */
export type FacetIntegrityCheck = 'lockfile' | 'A' | 'B' | 'C' | 'git'

/**
 * A facet-level integrity failure. The expected/observed values are
 * hashes over the canonical archive — the facet as a whole.
 *
 * Pure data: no `Error` instance, no stack trace, no thrown exception.
 */
export interface FacetIntegrityFailure {
  kind: 'facet'
  facet: string
  check: FacetIntegrityCheck
  expected: string
  observed: string
}

/**
 * An asset-level integrity failure. A specific file within the facet's
 * per-asset hash table did not match the build manifest's recorded
 * hash. Detected at cache-write time by `cachePutVerified`.
 *
 * The `path` field identifies which asset failed (e.g. `'facet.json'`,
 * `'skills/foo/SKILL.md'`). When the asset file is missing or
 * unreadable, `observed` is the sentinel string `'<missing>'`.
 *
 * Pure data: no `Error` instance, no stack trace, no thrown exception.
 */
export interface AssetIntegrityFailure {
  kind: 'asset'
  facet: string
  path: string
  expected: string
  observed: string
}

/**
 * Discriminated union of all integrity failure shapes. Pattern match
 * on `kind` to handle each.
 */
export type IntegrityFailure = FacetIntegrityFailure | AssetIntegrityFailure

/**
 * Result of an integrity verification. Discriminated by `ok`.
 *
 * The verifier never throws. Callers branch on `result.ok` and either
 * proceed (on success) or surface the structured failure (on rejection).
 */
export type IntegrityResult = { ok: true } | { ok: false; failure: IntegrityFailure }

/**
 * Inputs to the registry three-check pipeline.
 *
 * Field semantics:
 *   - `expectedIntegrity`: from the registry's metadata API (the
 *     canonical fingerprint, `content_integrity`). The hash the
 *     registry claims this exact `(name, version)` should produce.
 *   - `archiveIntegrity`: from the downloaded archive's own
 *     `build-manifest.json`. The hash the archive claims about itself.
 *   - `computedIntegrity`: locally computed by GENUINELY re-hashing
 *     the extracted archive content (per-asset hashes + the canonical
 *     deterministic tar). The hash that's actually true. Callers MUST
 *     NOT feed the manifest's self-declared integrity here — that
 *     would make Check C compare the claim against itself.
 *   - `cachedIntegrity` (optional): present iff the resolution is a
 *     cache hit that passed the self-audit (content re-hashed against
 *     the sidecar — the value MUST be the audited recompute, never the
 *     sidecar's raw claim). When set, only Check A runs against
 *     `expectedIntegrity` and Checks B/C are skipped. Check A is the
 *     integrity-confirmation comparison the install pipeline applies
 *     on every audited cache hit that creates a lockfile entry: the
 *     audited content vs. the registry's published fingerprint.
 *   - `lockfileIntegrity` (optional): present iff the project's lockfile
 *     pins this `(name, version)`. When set, the registry's
 *     `expectedIntegrity` is first checked against it; mismatch is
 *     reported with `check: 'lockfile'` and is the highest-priority
 *     failure mode.
 */
export interface RegistryIntegrityInput {
  facet: string
  expectedIntegrity: string
  archiveIntegrity: string
  computedIntegrity: string
  cachedIntegrity?: string
  lockfileIntegrity?: string
}

/**
 * Inputs to the git one-check pipeline.
 *
 * Git sources have only the locally-built integrity to check against the
 * lockfile's recorded integrity. There is no metadata API; the symbolic
 * ref is what the user trusts.
 */
export interface GitIntegrityInput {
  facet: string
  computedIntegrity: string
  lockfileIntegrity: string
}
