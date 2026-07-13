/**
 * Path-safety guard for asset names used as relative filesystem paths.
 *
 * This is the **path-safety** check, NOT the authoring grammar. It rejects
 * names that could escape an adapter's base directory when used as a path
 * (e.g. `<baseDir>/skills/<name>/SKILL.md`), but it deliberately permits
 * non-kebab names like `MySkill` or `foo_bar` — enforcing the Agent Skills
 * name grammar is a separate, stricter concern that lives in
 * `@agent-facets/protocol` (`validateAssetName` / `parseAssetName` in
 * `schemas/asset-name.ts`).
 *
 * This guard remains the right tool where the input is a *filesystem path*
 * rather than an author-declared name: archive-manifest keys and inner-tar
 * entry names (protocol's integrity validation), cache-audit paths and
 * receipt asset entries (engine), and lockfile asset names — the lockfile
 * intentionally stays on path safety so legacy installs with non-kebab names
 * still load and can be removed. The protocol manifest schema, by contrast,
 * uses the stricter grammar because manifest keys are author-declared names.
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
