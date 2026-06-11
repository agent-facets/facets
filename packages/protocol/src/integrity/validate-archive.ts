import { type Validated, type ValidationError, validateAssetName } from '@agent-facets/common'
import { computeContentHash, INNER_ARCHIVE_NAME, parseFacetArchive, parseInnerArchive } from '../build/content-hash.ts'
import { detectNamingCollisions } from '../build/detect-collisions.ts'
import { validateContentFiles } from '../build/validate-content.ts'
import { validateCompactFacets } from '../build/validate-facets.ts'
import { FACET_MANIFEST_FILE, resolvePromptsFromMap, validateFacetManifest } from '../loaders/facet.ts'
import type { BuildManifest } from '../schemas/build-manifest.ts'
import type { FacetManifest } from '../schemas/facet-manifest.ts'
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
 * A single per-asset entry the verifier extracted and verified from the
 * inner archive.
 *
 *   - `path` — the in-archive path (e.g. `'facet.json'`,
 *     `'skills/foo/SKILL.md'`).
 *   - `bytes` — the uncompressed contents of the entry.
 *   - `hash` — the recomputed content hash of `bytes`, already confirmed
 *     to equal the build manifest's `assets[path]`. This struct only
 *     appears on the success branch.
 */
export interface VerifiedAsset {
  path: string
  bytes: Uint8Array
  hash: string
}

/**
 * The fully verified contents of a built `.facet`.
 *
 * Carries the parsed `build-manifest.json`, the parsed embedded
 * `facet.json`, and the per-asset entries (with bytes + recomputed
 * hashes). Consumers use these to address an upload (CLI), persist
 * package metadata + asset bytes (registry), or both.
 */
export interface VerifiedArchive {
  buildManifest: BuildManifest
  facetManifest: FacetManifest
  assets: VerifiedAsset[]
}

/**
 * Verify a built `.facet` end-to-end. Returns `Validated<VerifiedArchive>`.
 *
 * The single archive-verification operation any facet-compatible system
 * uses to verify the bytes of a built `.facet` before treating it as
 * trusted. Both the CLI (`facet publish`) and the registry adopt this
 * function; neither stringing together lower-level primitives by hand.
 *
 * Order of checks (each step short-circuits to a `Validated` failure on
 * error; no step throws):
 *
 *   1. Parse the outer tar via `parseFacetArchive` — yields the
 *      validated `build-manifest.json` and the still-gzipped
 *      `innerArchiveBytes`. Failures: malformed outer container,
 *      missing entry, invalid build-manifest JSON, build-manifest schema
 *      violation.
 *   2. Decompress `innerArchiveBytes` via the injected `gunzip`.
 *      Failures: `'too-large'` (decompressor refused, e.g. gzip-bomb
 *      cap) or `'corrupt'` (inflate error, truncated stream).
 *   3. Compute the content hash of the gunzipped inner tar and verify
 *      it equals `buildManifest.integrity` (check `'C'`, via
 *      `verifyHash`). Failure surfaces as a `ValidationError` rooted at
 *      `INNER_ARCHIVE_NAME`.
 *   4. Parse the inner tar via `parseInnerArchive` → entries. Failures:
 *      malformed inner tar.
 *   5. For each entry: recompute its hash and verify it equals
 *      `buildManifest.assets[entry.path]`. Detect any entry missing
 *      from `assets`, and any asset key with no matching entry.
 *      Failures surface as one `ValidationError` per asset, rooted at
 *      the in-archive path.
 *   6. Locate the inner archive's `facet.json` entry and validate it
 *      against the facet-manifest schema (via `validateFacetManifest`).
 *      Failures surface unchanged, with their `path` re-rooted at
 *      `FACET_MANIFEST_FILE`.
 *   7. Reconstruct a `ResolvedFacetManifest` from the inner-tar entries
 *      (using `resolvePromptsFromMap`) and run the build validators
 *      (`validateContentFiles`, `detectNamingCollisions`,
 *      `validateCompactFacets`). Adapter-metadata validation is
 *      deliberately skipped — verification confirms the captured bytes
 *      are intact, not that the publisher's adapter code would still
 *      produce them today.
 *
 * NEVER throws — every failure mode is part of the `Validated<>`
 * contract.
 */
export async function validateFacetArchive(
  outerTarBytes: Uint8Array,
  options: { gunzip: GunzipFn },
): Promise<Validated<VerifiedArchive>> {
  // Step 1: parse outer tar (yields build manifest + still-gzipped inner bytes)
  const outerResult = parseFacetArchive(outerTarBytes)
  if (!outerResult.ok) {
    return outerResult
  }
  const { buildManifest, innerArchiveBytes } = outerResult.data

  // Step 2: decompress inner archive via injected gunzip
  const gunzipResult = await options.gunzip(innerArchiveBytes)
  if (!gunzipResult.ok) {
    const message =
      gunzipResult.reason === 'too-large'
        ? `Decompressor refused: inner archive exceeds the caller's allowed decompressed size.`
        : `Decompressor refused: inner archive is not valid gzip (corrupt or truncated).`
    return {
      ok: false,
      errors: [
        {
          path: INNER_ARCHIVE_NAME,
          message,
          expected: 'gzip within the caller-allowed size limit for decompression',
          actual: gunzipResult.reason,
        },
      ],
    }
  }
  const innerTarBytes = gunzipResult.bytes

  // Step 3: verify recomputed content hash equals build manifest's integrity
  const computedIntegrity = computeContentHash(innerTarBytes)
  const integrityResult = verifyHash(buildManifest.archive, 'C', buildManifest.integrity, computedIntegrity)
  if (!integrityResult.ok) {
    return {
      ok: false,
      errors: [
        {
          path: INNER_ARCHIVE_NAME,
          message: `Inner archive content hash does not match the build manifest's integrity value.`,
          expected: integrityResult.failure.expected,
          actual: integrityResult.failure.observed,
        },
      ],
    }
  }

  // Step 4: parse inner tar into entries
  const innerResult = parseInnerArchive(innerTarBytes)
  if (!innerResult.ok) {
    // parseInnerArchive roots errors at '' (the inner archive is the unit
    // being parsed). Re-root at INNER_ARCHIVE_NAME so callers can
    // disambiguate from per-asset errors (which are rooted at in-archive
    // paths).
    return {
      ok: false,
      errors: innerResult.errors.map((e) => ({ ...e, path: INNER_ARCHIVE_NAME })),
    }
  }
  const innerEntries = innerResult.entries

  // Step 4b: validate all path names are safe before reconciliation.
  // Defense-in-depth: reject traversal paths (../, absolute, backslash)
  // in both the build manifest's asset keys and the inner tar's entry
  // names before any hashing work. A malicious archive that smuggles an
  // unsafe path through either channel is stopped here.
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
  for (const entry of innerEntries) {
    const check = validateAssetName(entry.name)
    if (!check.ok) {
      pathSafetyErrors.push({
        path: entry.name,
        message: `Inner archive entry name fails path safety validation: ${check.reason}`,
        expected: 'safe relative path',
        actual: entry.name,
      })
    }
  }
  if (pathSafetyErrors.length > 0) {
    return { ok: false, errors: pathSafetyErrors }
  }

  // Step 5: per-asset hash reconciliation
  const assetErrors: ValidationError[] = []
  const verifiedAssets: VerifiedAsset[] = []
  const declaredAssets = new Set(Object.keys(buildManifest.assets))
  const observedPaths = new Set<string>()

  for (const entry of innerEntries) {
    const path = entry.name
    // `nanotar` returns `data: undefined` for zero-byte file entries (we
    // verified this against the installed version). Treat undefined as
    // an empty payload so that an empty-but-declared asset is detected
    // by the per-asset hash check and the content-rule validator at
    // Step 7 — not silently dropped as if it were a directory marker.
    const bytes: Uint8Array =
      entry.data instanceof Uint8Array ? entry.data : entry.data ? new Uint8Array(entry.data) : new Uint8Array(0)
    observedPaths.add(path)
    const observedHash = computeContentHash(bytes)
    const expectedHash = buildManifest.assets[path]
    if (expectedHash === undefined) {
      assetErrors.push({
        path,
        message: `Inner archive contains an undeclared entry: not present in build manifest's assets map.`,
        expected: 'declared in build manifest',
        actual: 'undeclared entry',
      })
      continue
    }
    if (expectedHash !== observedHash) {
      assetErrors.push({
        path,
        message: `Asset content hash does not match the build manifest's recorded hash.`,
        expected: expectedHash,
        actual: observedHash,
      })
      continue
    }
    verifiedAssets.push({ path, bytes, hash: observedHash })
  }

  for (const declared of declaredAssets) {
    if (!observedPaths.has(declared)) {
      assetErrors.push({
        path: declared,
        message: `Asset declared in the build manifest is missing from the inner archive.`,
        expected: 'present in inner archive',
        actual: 'missing',
      })
    }
  }

  if (assetErrors.length > 0) {
    return { ok: false, errors: assetErrors }
  }

  // Step 6: validate embedded facet.json against the facet-manifest schema
  const facetManifestAsset = verifiedAssets.find((a) => a.path === FACET_MANIFEST_FILE)
  if (!facetManifestAsset) {
    return {
      ok: false,
      errors: [
        {
          path: FACET_MANIFEST_FILE,
          message: `Inner archive is missing the embedded ${FACET_MANIFEST_FILE} entry.`,
          expected: `${FACET_MANIFEST_FILE} present in inner archive`,
          actual: 'missing',
        },
      ],
    }
  }
  const facetResult = validateFacetManifest(facetManifestAsset.bytes)
  if (!facetResult.ok) {
    return {
      ok: false,
      errors: facetResult.errors.map((e) => ({
        ...e,
        path: e.path ? `${FACET_MANIFEST_FILE}.${e.path}` : FACET_MANIFEST_FILE,
      })),
    }
  }
  const facetManifest = facetResult.data

  // Step 6b: outer-exclusivity — reject inner-tar entries not derivable
  // from the embedded facet.json. The build manifest is attacker-controlled
  // so Step 5's "declared in build manifest" check is insufficient; the
  // facet manifest is the trust root. A malicious archive that passes
  // Steps 1–6 but contains extra files (e.g. a binary whose execution
  // the skill prompt requests) would land on disk at install time,
  // enabling supply-chain code execution.
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
      errors: extraPaths.map((a) => ({
        path: a.path,
        message: `Inner archive contains a file not declared by ${FACET_MANIFEST_FILE}. Only conventional asset paths (skills, agents, commands) and ${FACET_MANIFEST_FILE} are permitted.`,
        expected: 'path derivable from facet.json',
        actual: 'undeclared extra file',
      })),
    }
  }

  // Step 7: reconstruct ResolvedFacetManifest and run build validators
  const contentByPath: Record<string, string> = {}
  const decoder = new TextDecoder()
  for (const asset of verifiedAssets) {
    contentByPath[asset.path] = decoder.decode(asset.bytes)
  }
  const resolvedResult = resolvePromptsFromMap(facetManifest, contentByPath)
  if (!resolvedResult.ok) {
    return resolvedResult
  }
  const contentErrors = validateContentFiles(resolvedResult.data)
  const collisionErrors = detectNamingCollisions(facetManifest)
  const compactFacetsErrors = validateCompactFacets(facetManifest)
  const ruleErrors = [...contentErrors, ...collisionErrors, ...compactFacetsErrors]
  if (ruleErrors.length > 0) {
    return { ok: false, errors: ruleErrors }
  }

  return {
    ok: true,
    data: {
      buildManifest,
      facetManifest,
      assets: verifiedAssets,
    },
  }
}
