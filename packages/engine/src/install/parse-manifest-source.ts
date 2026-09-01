import { parseFacetSource } from '../sources/facet/parse-source.ts'
import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import type { ParseResult, Source } from '../sources/facet/types.ts'

/**
 * Parse one `facets.json` entry into a `Source`.
 *
 * The manifest is a `name → value` map, and the value means different
 * things depending on where the facet comes from. For a registry source
 * the value is a bare version specifier (`1.2.3`, `1.*`, `*`, `latest`)
 * and the facet name lives in the KEY, so a value that parses as a bare
 * `VersionSpec` is recombined into `${facetName}@${value}`. For git and
 * local sources the value is a self-contained source string (a URL, a
 * `file:` path) and the key is just a label, so it is parsed standalone.
 *
 * This keeps `facets.json` values semver-shaped for registry entries —
 * what the user sees is `1.2.3`, not `cowsay@1.2.3` — while still
 * round-tripping through source resolution.
 *
 * Every reader of the manifest must apply this rule identically: commit
 * resolution, drift detection, and update discovery all decide what kind
 * of source an entry is, and a disagreement between them would mean one
 * subsystem thinking a facet is a registry entry while another treats
 * the same text as a path.
 */
export function parseManifestFacetSource(facetName: string, value: string): ParseResult<Source> {
  const sourceString = parseVersionSpec(value).ok ? `${facetName}@${value}` : value
  return parseFacetSource(sourceString)
}
