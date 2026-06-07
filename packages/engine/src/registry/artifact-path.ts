import { join } from 'node:path'

/**
 * Single source of truth for the build-output directory. `facet build`
 * writes here; `facet publish` reads from here. Both sides MUST import
 * this constant rather than inlining `'dist'` so a future change to the
 * convention is mechanical.
 */
export const BUILD_OUTPUT_DIR = 'dist'

/**
 * Canonical filename for a built `.facet` archive given a facet's name
 * and version. Used by `runBuildPipeline` to set `archiveFilename` on
 * `BuildResult` and by `facet publish` to compute the expected path of
 * a prior build's output.
 *
 * Names are taken straight from the validated `FacetManifest`. If facet
 * names are treated as path segments (e.g. namespaced `acme/cowsay`),
 * callers/writers must ensure the corresponding directories exist and
 * that the name is safe for filesystem use.
 *
 * Versions are semver strings.
 */
export function buildArtifactFilename(name: string, version: string): string {
  return `${name}-${version}.facet`
}

/**
 * Absolute path at which a built `.facet` for `(name, version)` is
 * expected to live under a project root. Equivalent to
 * `join(rootDir, BUILD_OUTPUT_DIR, buildArtifactFilename(name, version))`.
 */
export function buildArtifactPath(rootDir: string, name: string, version: string): string {
  return join(rootDir, BUILD_OUTPUT_DIR, buildArtifactFilename(name, version))
}

/**
 * Result of scanning the build-output directory for built `.facet`
 * archives. Discriminated by `state`:
 *
 *   - `'none'`     — `dist/` is missing or contains no `.facet` files.
 *                    Caller's "no built artifact" branch.
 *   - `'single'`   — exactly one `.facet` was found. Caller verifies
 *                    it and either ships it (in sync), prompts on
 *                    drift, or rebuilds (drift accepted).
 *   - `'multiple'` — more than one `.facet` was found. This should not
 *                    happen in a project that only uses `facet build`
 *                    (`writeBuildOutput` purges `dist/` before each
 *                    write — see write-output.ts). When it does, the
 *                    user manually placed files; the caller treats it
 *                    as a pre-flight error and lists the offending
 *                    paths so the user can clean up.
 */
export type DiscoverArtifactResult =
  | { state: 'none' }
  | { state: 'single'; path: string }
  | { state: 'multiple'; paths: string[] }

/**
 * Scan `<rootDir>/dist/` for `.facet` archives. Returns a
 * discriminated state so the caller can branch without duplicating
 * the "no dist/" vs. "empty dist/" vs. "multiple matches" reasoning.
 *
 * Recursive: the glob descends into subdirectories so namespaced
 * facets (whose `name` includes a `/`, producing nested paths like
 * `dist/acme/cowsay-0.1.0.facet`) are discovered alongside flat ones.
 *
 * The glob matches every `.facet` regardless of name. Scoping the
 * pattern by source name would silently hide an artifact whose
 * embedded name differs from the source's current name — exactly the
 * identity-drift case the publish flow needs to surface in the prompt.
 * A renamed facet is still discovered; publish reasons about the
 * mismatch as identity drift.
 *
 * Missing or unreadable `dist/` is treated as `'none'` rather than an
 * error — the directory simply hasn't been created (no prior build)
 * or was cleaned up. Publish's missing-artifact branch handles this
 * the same as "directory present but empty."
 */
export async function discoverBuiltArtifacts(rootDir: string): Promise<DiscoverArtifactResult> {
  const distDir = join(rootDir, BUILD_OUTPUT_DIR)
  const glob = new Bun.Glob('**/*.facet')
  const matches: string[] = []
  try {
    for await (const rel of glob.scan({ cwd: distDir, onlyFiles: true })) {
      matches.push(join(distDir, rel))
    }
  } catch {
    // Bun.Glob.scan over a missing directory throws; treat the same
    // as an empty dist/.
    return { state: 'none' }
  }
  if (matches.length === 0) return { state: 'none' }
  if (matches.length === 1) {
    const path = matches[0]
    if (path === undefined) return { state: 'none' }
    return { state: 'single', path }
  }
  return { state: 'multiple', paths: matches.sort() }
}
