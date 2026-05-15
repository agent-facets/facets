import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Single source of truth for the base directory holding all
 * facet-managed state. Every per-subsystem directory (cache, adapters,
 * locks, bin) derives from this root.
 *
 * Precedence:
 *   1. `process.env.FACET_DIR` — when set to a non-empty value (trimmed),
 *      this is THE override. There are no separate per-subsystem env
 *      vars; `FACET_DIR` controls everything that facet writes to disk.
 *   2. Default: `~/.facet`.
 *
 * Whitespace-only env values (`FACET_DIR=`, `FACET_DIR=" "`) are treated
 * as unset so misconfigurations don't accidentally point everything at a
 * relative path or the current directory.
 *
 * Read on every call (not memoized) so test harnesses can redirect per
 * test via `process.env.FACET_DIR = mkdtempSync(...)` and per subprocess
 * by spawning with a different `FACET_DIR` in the child's environment.
 */
export function resolveFacetDir(): string {
  const override = process.env.FACET_DIR?.trim()
  return override !== undefined && override.length > 0 ? override : join(homedir(), '.facet')
}

/** Cache root: `$FACET_DIR/cache/`. */
export function facetCacheDir(): string {
  return join(resolveFacetDir(), 'cache')
}

/** Installed-adapter root: `$FACET_DIR/adapters/`. */
export function facetAdaptersDir(): string {
  return join(resolveFacetDir(), 'adapters')
}

/** Install advisory locks: `$FACET_DIR/locks/`. */
export function facetLocksDir(): string {
  return join(resolveFacetDir(), 'locks')
}

/** Curl-installed binary directory: `$FACET_DIR/bin/`. */
export function facetBinDir(): string {
  return join(resolveFacetDir(), 'bin')
}
