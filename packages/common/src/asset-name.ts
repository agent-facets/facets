/**
 * Asset-name validation shared across core (manifest + lockfile schemas) and
 * the adapter SDK (defensive check before filesystem use).
 *
 * An asset name is used as a relative filesystem path under the adapter's
 * base directory (e.g. `<baseDir>/skills/<name>/SKILL.md`). Unsafe names can
 * escape the base directory via `..` segments or platform-specific
 * separators. This helper is the single source of truth for what "safe"
 * means so the manifest schema, the lockfile schema, and the adapter I/O
 * helpers agree — manifest-time and lockfile-time inputs get the same guard.
 *
 * Rules (rejects):
 *  - contains a backslash (`\`) — Windows path separator
 *  - contains empty, `.`, or `..` segments when split on `/`
 *
 * Forward slashes are permitted because facet namespacing uses them
 * (e.g. `viper-plans/planning`). A single leading or trailing `/` counts as
 * an empty segment and is rejected.
 */
export type AssetNameValidation = { ok: true } | { ok: false; reason: string }

export function validateAssetName(name: string): AssetNameValidation {
  if (name.includes('\\')) {
    return {
      ok: false,
      reason: `contains a backslash ("\\"), which is a path separator on Windows`,
    }
  }
  for (const seg of name.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') {
      return {
        ok: false,
        reason: `contains empty, "." or ".." path segments (asset names are used as filesystem paths)`,
      }
    }
  }
  return { ok: true }
}
