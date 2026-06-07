import type { FacetManifest } from '@agent-facets/protocol'

/**
 * Result of comparing a built artifact's embedded facet manifest
 * against the current source-tree facet manifest.
 *
 * The `reason` discriminator on the failure branch lets the CLI render
 * a precise user-facing message ("name has changed", "version has
 * changed", "manifest content has changed") without re-deriving the
 * comparison.
 */
export type DriftResult = { inSync: true } | { inSync: false; reason: 'name' | 'version' | 'content' }

/**
 * Compare a built artifact's embedded facet manifest against the
 * current source-tree facet manifest. Both inputs are already
 * schema-validated `FacetManifest` values; comparing parsed values
 * normalizes away formatting (whitespace, indentation) and key-order
 * differences for free, per the design risk note "compare
 * parsed/normalized manifests, not raw bytes."
 *
 * Scope: manifest-level drift only. Prompt-content edits (a user who
 * edited `skills/foo/SKILL.md` but did not change `facet.json`) do not
 * show up here — detecting those would require re-resolving and
 * re-hashing every prompt on every publish. The proposal scopes the
 * drift-detection-and-offer to the common "edited facet.json and
 * forgot to rebuild" case; for the broader "I edited a prompt"
 * situation, the user runs `facet build && facet publish`.
 *
 * `name` and `version` are checked first because they alone determine
 * the upload address — a mismatch is the most likely source of a
 * surprising publish ("I bumped to 1.1.0 but the registry now has my
 * stale 1.0.0 artifact under 1.1.0"). The structural content check
 * catches everything else.
 */
export function detectManifestDrift(source: FacetManifest, embedded: FacetManifest): DriftResult {
  if (source.name !== embedded.name) return { inSync: false, reason: 'name' }
  if (source.version !== embedded.version) return { inSync: false, reason: 'version' }
  // Canonicalize both to sorted-key JSON for a structural-equality
  // comparison. Avoids a deep-equal dependency for a single call site.
  const sourceJson = JSON.stringify(source, sortedReplacer)
  const embeddedJson = JSON.stringify(embedded, sortedReplacer)
  if (sourceJson !== embeddedJson) return { inSync: false, reason: 'content' }
  return { inSync: true }
}

/**
 * JSON.stringify replacer that sorts object keys recursively, producing
 * a canonical text form. Arrays preserve their order (semantic for
 * arrays); plain objects are re-emitted with keys sorted.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = obj[k]
    }
    return sorted
  }
  return value
}
