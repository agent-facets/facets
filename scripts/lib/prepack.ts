/**
 * Prepack utilities — rewrites workspace:* dependencies to concrete version
 * specifiers and applies `publishConfig` field overrides so that
 * `npm publish` produces a valid tarball.
 *
 * The core logic is pure functions (`rewriteWorkspaceDeps`, `applyPublishConfig`)
 * that are fully testable without touching the filesystem.
 */

/** Dependency field names that may contain workspace: specifiers. */
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

/**
 * Keys within `publishConfig` that should be hoisted to the top-level package
 * manifest at publish time. Mirrors pnpm's documented behavior.
 *
 * Other `publishConfig` keys (e.g. `access`, `registry`, `tag`, `provenance`)
 * are npm CLI configuration and remain under `publishConfig` so that
 * `npm publish` still consumes them.
 */
const PUBLISH_CONFIG_OVERRIDE_KEYS = ['exports', 'main', 'types', 'module', 'bin'] as const

/**
 * A version resolver — given a package name, returns its resolved version
 * string (e.g. "0.1.2") or null if the package can't be found.
 */
export type VersionResolver = (name: string) => Promise<string | null>

/**
 * Rewrite every `workspace:` specifier in a package manifest to a concrete
 * semver range, using `resolve` to look up sibling package versions.
 *
 * Rewrite rules (matches pnpm publish behavior):
 * - `workspace:*`        → `<resolved>` (exact pinned version)
 * - `workspace:^`        → `^<resolved>`
 * - `workspace:~`        → `~<resolved>`
 * - `workspace:<semver>` → `<semver>` (strip prefix, keep literal version)
 *
 * Returns `{ pkg, modified }` where `modified` is true if any rewrite happened.
 * Throws if a workspace package cannot be resolved.
 */
export async function rewriteWorkspaceDeps(
  pkg: Record<string, unknown>,
  resolve: VersionResolver,
): Promise<{ pkg: Record<string, unknown>; modified: boolean }> {
  // Deep-clone to avoid mutating the input
  const result = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>
  let modified = false

  for (const field of DEP_FIELDS) {
    const deps = result[field]
    if (!deps || typeof deps !== 'object') continue

    for (const [name, specifier] of Object.entries(deps as Record<string, string>)) {
      if (!specifier.startsWith('workspace:')) continue

      const version = await resolve(name)
      if (!version) {
        throw new Error(`prepack: could not resolve workspace package "${name}"`)
      }

      const suffix = specifier.slice('workspace:'.length)
      let rewritten: string

      if (suffix === '*') {
        rewritten = version
      } else if (suffix === '^') {
        rewritten = `^${version}`
      } else if (suffix === '~') {
        rewritten = `~${version}`
      } else {
        // Literal version — just strip the `workspace:` prefix
        rewritten = suffix
      }

      ;(deps as Record<string, string>)[name] = rewritten
      modified = true
    }
  }

  return { pkg: result, modified }
}

/**
 * Hoist whitelisted keys from `pkg.publishConfig` to the top-level package
 * manifest. Mirrors pnpm's `publishConfig` behavior, which npm does not
 * implement natively.
 *
 * Only keys listed in `PUBLISH_CONFIG_OVERRIDE_KEYS` are hoisted. Other keys
 * (npm CLI config such as `access`, `registry`, `tag`, `provenance`) are
 * left under `publishConfig` so `npm publish` still consumes them. The
 * `publishConfig` object itself is preserved on the output.
 *
 * Returns `{ pkg, modified }` where `modified` is true if any hoist happened.
 */
export function applyPublishConfig(pkg: Record<string, unknown>): { pkg: Record<string, unknown>; modified: boolean } {
  const publishConfig = pkg.publishConfig
  if (!publishConfig || typeof publishConfig !== 'object') {
    return { pkg, modified: false }
  }

  // Deep-clone so we don't mutate the caller's object
  const result = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>
  // Read overrides from the CLONED publishConfig, not the original — otherwise
  // object-valued overrides like `exports` would end up sharing references
  // between input and output, partially defeating the deep clone.
  const clonedOverrides = result.publishConfig as Record<string, unknown>
  let modified = false

  for (const key of PUBLISH_CONFIG_OVERRIDE_KEYS) {
    if (key in clonedOverrides) {
      result[key] = clonedOverrides[key]
      modified = true
    }
  }

  return { pkg: result, modified }
}

/**
 * Build a `VersionResolver` that scans workspace packages on disk.
 *
 * Reads the root `package.json` at `rootDir` to discover workspace glob
 * patterns, then scans each for a `package.json` whose `name` matches.
 */
export function createDiskResolver(rootDir: string): VersionResolver {
  return async (name: string): Promise<string | null> => {
    const { resolve: pathResolve, dirname } = await import('node:path')
    const rootPkg = await Bun.file(pathResolve(rootDir, 'package.json')).json()
    const patterns: string[] = rootPkg.workspaces?.packages ?? rootPkg.workspaces ?? []

    for (const pattern of patterns) {
      const baseDir = pathResolve(dirname(pathResolve(rootDir, 'package.json')), pattern.replace('/*', ''))
      for await (const entry of new Bun.Glob('*/package.json').scan(baseDir)) {
        const candidate = await Bun.file(pathResolve(baseDir, entry)).json()
        if (candidate.name === name) return candidate.version as string
      }
    }

    return null
  }
}
