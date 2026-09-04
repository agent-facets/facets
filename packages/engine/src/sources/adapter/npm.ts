import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
// Subpath import keeps engine's runtime graph free of the full SDK.
import { ADAPTER_API_VERSION_PACKAGE_FIELD } from '@agent-facets/adapter/api-version'
import { satisfies } from '@agent-facets/protocol'
import { parseTarGzip } from 'nanotar'
import {
  type ApiDeclarationClassification,
  classifyApiDeclaration,
  SUPPORTED_ADAPTER_APIS,
} from '../../adapters/api-compatibility.ts'
import type { NpmVersionRequest } from './specifier.ts'

/** Default npm registry. Overridable per call for fake-registry tests. */
const DEFAULT_REGISTRY_BASE_URL = 'https://registry.npmjs.org'

export interface NpmResolveOptions {
  /** Registry base URL (no trailing slash). Defaults to the public npm registry. */
  registryBaseUrl?: string
  /** Fetch implementation. Defaults to the runtime global. */
  fetch?: typeof globalThis.fetch
}

/**
 * The release selected by compatibility-aware resolution. Carries every
 * field download and installation provenance need, so all stages use the
 * same selected record.
 */
export interface NpmResolvedRelease {
  packageName: string
  /** Exact `M.N.P` package version of the selected release. */
  version: string
  /** The release's declared adapter SDK API — validated and CLI-supported. */
  apiVersion: string
  tarballUrl: string
  /** Registry integrity anchors for the tarball, verbatim. */
  dist: { integrity?: string; shasum?: string }
}

/**
 * Discriminated result for `resolveNpmAdapter`.
 *
 *   - `metadata-network-error` / `metadata-fetch-failed` — the packument
 *     request failed at the network/HTTP level.
 *   - `metadata-invalid` — the packument parsed but its shape is
 *     unusable (missing `versions`, or the selected release lacks a
 *     tarball URL).
 *   - `no-compatible-release` — no stable release satisfying the
 *     request declares a CLI-supported adapter SDK API. `newestConsidered`
 *     is the newest release that satisfied the package-version request
 *     (when any did), with its API classification — absent when nothing
 *     satisfied the request at all.
 */
export type ResolveNpmAdapterResult =
  | { ok: true; release: NpmResolvedRelease }
  | { ok: false; reason: 'metadata-network-error'; packageName: string; cause: string }
  | { ok: false; reason: 'metadata-fetch-failed'; packageName: string; status: number; statusText: string }
  | { ok: false; reason: 'metadata-invalid'; packageName: string; detail: string }
  | {
      ok: false
      reason: 'no-compatible-release'
      packageName: string
      request: NpmVersionRequest
      supported: readonly string[]
      newestConsidered?: { version: string; declared: ApiDeclarationClassification }
    }

/** A stable release parsed out of the packument's `versions` map. */
interface StableRelease {
  version: string
  components: { major: number; minor: number; patch: number }
  declared: ApiDeclarationClassification
  dist: { tarball?: string; integrity?: string; shasum?: string }
}

const STABLE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/

/**
 * Resolve an npm adapter request to a concrete release using the full
 * packument (`GET <registry>/<name>`).
 *
 * The full document is required: the abbreviated
 * `application/vnd.npm.install-v1+json` representation can omit custom
 * per-version fields such as the adapter SDK API declaration.
 *
 * Selection rules:
 *   - only stable `M.N.P` versions are considered (prereleases excluded);
 *   - the user's package-version request constrains the candidate set;
 *   - releases whose adapter SDK API declaration is missing, malformed, or
 *     unsupported are ineligible;
 *   - the highest remaining semantic version wins.
 *
 * An exact request considers only that release — incompatibility fails
 * rather than substituting another version. `dist-tags` (including
 * `latest`) are never consulted; explicit `latest` means "highest
 * compatible published version".
 */
export async function resolveNpmAdapter(
  packageName: string,
  request: NpmVersionRequest,
  opts: NpmResolveOptions = {},
): Promise<ResolveNpmAdapterResult> {
  const base = opts.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL
  const registryUrl = `${base}/${packageName}`

  let response: Response
  try {
    response = await (opts.fetch ?? globalThis.fetch)(registryUrl)
  } catch (e) {
    return {
      ok: false,
      reason: 'metadata-network-error',
      packageName,
      cause: e instanceof Error ? e.message : String(e),
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: 'metadata-fetch-failed',
      packageName,
      status: response.status,
      statusText: response.statusText,
    }
  }

  let packument: unknown
  try {
    packument = await response.json()
  } catch (e) {
    return {
      ok: false,
      reason: 'metadata-invalid',
      packageName,
      detail: `packument is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const versionsField = (packument as { versions?: unknown } | null)?.versions
  if (versionsField === null || typeof versionsField !== 'object') {
    return { ok: false, reason: 'metadata-invalid', packageName, detail: 'packument has no "versions" object' }
  }

  // Parse stable releases that satisfy the package-version request.
  const considered: StableRelease[] = []
  for (const [version, entry] of Object.entries(versionsField as Record<string, unknown>)) {
    const match = STABLE_VERSION_RE.exec(version)
    if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) continue
    const components = {
      major: Number.parseInt(match[1], 10),
      minor: Number.parseInt(match[2], 10),
      patch: Number.parseInt(match[3], 10),
    }
    if (!satisfiesRequest(components, request)) continue

    const record = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
    const dist = typeof record.dist === 'object' && record.dist !== null ? (record.dist as Record<string, unknown>) : {}
    considered.push({
      version,
      components,
      declared: classifyApiDeclaration(record[ADAPTER_API_VERSION_PACKAGE_FIELD]),
      dist: {
        tarball: typeof dist.tarball === 'string' ? dist.tarball : undefined,
        integrity: typeof dist.integrity === 'string' ? dist.integrity : undefined,
        shasum: typeof dist.shasum === 'string' ? dist.shasum : undefined,
      },
    })
  }

  const newestConsidered = highestBy(considered)
  const eligible = considered.filter((release) => release.declared.kind === 'supported')
  const selected = highestBy(eligible)

  if (!selected) {
    return {
      ok: false,
      reason: 'no-compatible-release',
      packageName,
      request,
      supported: SUPPORTED_ADAPTER_APIS,
      ...(newestConsidered
        ? { newestConsidered: { version: newestConsidered.version, declared: newestConsidered.declared } }
        : {}),
    }
  }

  if (!selected.dist.tarball) {
    return {
      ok: false,
      reason: 'metadata-invalid',
      packageName,
      detail: `selected release ${selected.version} has no dist.tarball`,
    }
  }
  if (selected.declared.kind !== 'supported') {
    // Unreachable by construction (eligible filters on 'supported');
    // kept as a type-narrowing guard rather than a non-null assertion.
    return {
      ok: false,
      reason: 'metadata-invalid',
      packageName,
      detail: `selected release ${selected.version} lost its API classification`,
    }
  }

  return {
    ok: true,
    release: {
      packageName,
      version: selected.version,
      apiVersion: selected.declared.api,
      tarballUrl: selected.dist.tarball,
      dist: { integrity: selected.dist.integrity, shasum: selected.dist.shasum },
    },
  }
}

function satisfiesRequest(
  components: { major: number; minor: number; patch: number },
  request: NpmVersionRequest,
): boolean {
  switch (request.kind) {
    case 'implicit':
      return true
    case 'exact':
      return (
        components.major === request.major && components.minor === request.minor && components.patch === request.patch
      )
    case 'selector':
      return satisfies(components, request.spec)
  }
}

/** Highest release by semantic version order; undefined for an empty list. */
function highestBy(releases: readonly StableRelease[]): StableRelease | undefined {
  let best: StableRelease | undefined
  for (const release of releases) {
    if (!best || compareComponents(release.components, best.components) > 0) {
      best = release
    }
  }
  return best
}

function compareComponents(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/**
 * The integrity anchor that authenticated a downloaded tarball —
 * recorded verbatim in installation provenance.
 */
export type UsedIntegrity = { kind: 'sri'; value: string } | { kind: 'shasum'; value: string }

/**
 * Discriminated result for `downloadNpmRelease`. The success arm
 * carries the path to the extracted package and the integrity anchor
 * that authenticated the bytes; each failure arm carries the structured
 * fields the CLI needs to render a precise message.
 *
 *   - `tarball-fetch-failed` — `GET <tarball>` failed at the HTTP level.
 *   - `integrity-mismatch` — SRI check rejected the bytes.
 *   - `integrity-shasum-mismatch` — shasum check rejected the bytes.
 *   - `integrity-unsupported-algo` — the SRI string had no supported algorithm.
 *   - `integrity-missing` — the release shipped neither SRI nor shasum;
 *     we refuse to install untrusted bytes.
 *   - `tar-slip` — a tarball entry's resolved path escapes the
 *     extraction directory (`..`-traversal or absolute path).
 */
export type DownloadNpmResult =
  | { ok: true; path: string; usedIntegrity: UsedIntegrity }
  | { ok: false; reason: 'tarball-fetch-failed'; packageName: string; status: number; statusText: string }
  | { ok: false; reason: 'tarball-network-error'; packageName: string; cause: string }
  | { ok: false; reason: 'integrity-mismatch'; packageName: string; algo: string; expected: string; actual: string }
  | { ok: false; reason: 'integrity-unsupported-algo'; packageName: string; integrity: string }
  | { ok: false; reason: 'integrity-shasum-mismatch'; packageName: string; expected: string; actual: string }
  | { ok: false; reason: 'integrity-missing'; packageName: string }
  | { ok: false; reason: 'tar-slip'; packageName: string; entryName: string }

/**
 * Discriminated result for `verifyTarballIntegrity` — the success arm
 * reports which anchor authenticated the bytes, otherwise one of the
 * integrity-related failure variants from `DownloadNpmResult`. Exported
 * for direct unit-testing without a fake registry pipeline.
 */
export type VerifyTarballIntegrityResult =
  | { ok: true; usedIntegrity: UsedIntegrity }
  | Extract<
      DownloadNpmResult,
      | { reason: 'integrity-mismatch' }
      | { reason: 'integrity-unsupported-algo' }
      | { reason: 'integrity-shasum-mismatch' }
      | { reason: 'integrity-missing' }
    >

/**
 * Discriminated result for `assertInsideTempDir`. Exported for direct
 * unit-testing of the tar-slip guard.
 */
export type AssertInsideTempDirResult = { ok: true } | Extract<DownloadNpmResult, { reason: 'tar-slip' }>

/**
 * Download the resolved release's tarball to a temp directory.
 *
 * F16 hardening:
 *  - Verifies the downloaded bytes against the release's `dist.integrity`
 *    SRI string (Subresource Integrity, format: `sha<N>-<base64>`). Fails
 *    loud on mismatch so a compromised mirror or in-flight tamper is
 *    detectable. Supports sha512/sha384/sha256/sha1 (npm registry ships one).
 *  - Before writing each tarball entry, asserts the computed path stays
 *    inside `tempDir`. Rejects the whole package on any `..` or absolute
 *    traversal attempt (tar-slip).
 *
 * Returns a discriminated `DownloadNpmResult` — never throws on a
 * documented failure mode.
 */
export async function downloadNpmRelease(release: NpmResolvedRelease): Promise<DownloadNpmResult> {
  const { packageName } = release

  let tarballResponse: Response
  try {
    tarballResponse = await fetch(release.tarballUrl)
  } catch (e) {
    return {
      ok: false,
      reason: 'tarball-network-error',
      packageName,
      cause: e instanceof Error ? e.message : String(e),
    }
  }
  if (!tarballResponse.ok) {
    return {
      ok: false,
      reason: 'tarball-fetch-failed',
      packageName,
      status: tarballResponse.status,
      statusText: tarballResponse.statusText,
    }
  }

  const tarballBytes = new Uint8Array(await tarballResponse.arrayBuffer())

  // Integrity check. The registry normally ships `dist.integrity` (SRI);
  // older entries ship `dist.shasum` (hex sha1). Either is sufficient.
  const integrityResult = verifyTarballIntegrity(packageName, tarballBytes, release.dist.integrity, release.dist.shasum)
  if (!integrityResult.ok) return integrityResult

  // Extract to a temp directory
  const tempDir = await mkdtemp(join(tmpdir(), 'facet-adapter-npm-'))
  const entries = await parseTarGzip(tarballBytes)

  for (const entry of entries) {
    if (!entry.data) continue

    // npm tarballs are wrapped in a `package/` directory
    const relativePath = entry.name.replace(/^package\//, '')
    if (!relativePath) continue

    const outputPath = join(tempDir, relativePath)
    const insideResult = assertInsideTempDir(tempDir, outputPath, packageName, entry.name)
    if (!insideResult.ok) return insideResult
    await Bun.write(outputPath, entry.data)
  }

  return { ok: true, path: tempDir, usedIntegrity: integrityResult.usedIntegrity }
}

/**
 * Parse an SRI string (`sha512-<base64>`) and verify `bytes` hashes to the
 * expected digest. Falls back to `shasum` (hex sha1) when SRI is absent.
 * Returns a structured failure when integrity metadata is missing — we
 * refuse to install unhashed tarballs. On success, reports the exact
 * anchor that authenticated the bytes.
 *
 * Exported for direct unit-testing of the integrity guard without
 * standing up a whole fake registry + tarball pipeline.
 */
export function verifyTarballIntegrity(
  packageName: string,
  bytes: Uint8Array,
  integrity: string | undefined,
  shasum: string | undefined,
): VerifyTarballIntegrityResult {
  if (integrity) {
    // SRI can contain multiple space-separated alternatives; one match is enough.
    for (const candidate of integrity.split(/\s+/).filter(Boolean)) {
      const dashIndex = candidate.indexOf('-')
      if (dashIndex === -1) continue
      const algo = candidate.slice(0, dashIndex)
      const expected = candidate.slice(dashIndex + 1)
      if (!SUPPORTED_SRI_ALGOS.has(algo)) continue
      const actual = createHash(algo).update(bytes).digest('base64')
      if (actual === expected) return { ok: true, usedIntegrity: { kind: 'sri', value: candidate } }
      return { ok: false, reason: 'integrity-mismatch', packageName, algo, expected, actual }
    }
    return { ok: false, reason: 'integrity-unsupported-algo', packageName, integrity }
  }

  if (shasum) {
    const actual = createHash('sha1').update(bytes).digest('hex')
    if (actual !== shasum) {
      return { ok: false, reason: 'integrity-shasum-mismatch', packageName, expected: shasum, actual }
    }
    return { ok: true, usedIntegrity: { kind: 'shasum', value: shasum } }
  }

  return { ok: false, reason: 'integrity-missing', packageName }
}

const SUPPORTED_SRI_ALGOS = new Set(['sha512', 'sha384', 'sha256', 'sha1'])

/**
 * Tar-slip defense. Asserts `outputPath` is contained inside `tempDir` (not
 * equal, not escaping via `..`, not absolute). Uses `path.relative` which
 * returns `..` segments when the target escapes. Exported for unit tests.
 *
 * Returns a discriminated `AssertInsideTempDirResult`.
 */
export function assertInsideTempDir(
  tempDir: string,
  outputPath: string,
  packageName: string,
  entryName: string,
): AssertInsideTempDirResult {
  if (isAbsolute(outputPath) === false) {
    // join() always produces an absolute path when tempDir is absolute, so
    // this is a defense-in-depth check only.
    return { ok: false, reason: 'tar-slip', packageName, entryName }
  }
  const rel = relative(tempDir, outputPath)
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).some((s) => s === '..')) {
    return { ok: false, reason: 'tar-slip', packageName, entryName }
  }
  return { ok: true }
}
