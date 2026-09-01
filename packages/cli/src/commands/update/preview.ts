import type { FacetUpdateSelection, SelectedFacetUpdate, UpdateChoice, UpdatePlanRow } from '@agent-facets/engine'
import type { ManifestRewrite } from '../../tui/views/update/plan-view.tsx'

/**
 * What the plan view needs to draw a selection: which choice each facet
 * takes, and which `facets.json` values would change.
 *
 * Both are derived from the engine's validated selections rather than
 * recomputed, so a preview cannot describe an edit the write would not
 * make.
 */
export interface UpdatePreview {
  selected: ReadonlyMap<string, UpdateChoice>
  rewrites: ReadonlyMap<string, ManifestRewrite>
}

export function buildPreview(
  plan: readonly UpdatePlanRow[],
  selections: readonly FacetUpdateSelection[],
  validated: readonly SelectedFacetUpdate[],
): UpdatePreview {
  const selected = new Map<string, UpdateChoice>()
  for (const selection of selections) selected.set(selection.facetName, selection.choice)

  const authored = new Map<string, string>()
  for (const row of plan) {
    if (row.kind === 'unsupported-source') continue
    authored.set(row.facet.name, row.facet.authored.source)
  }

  const rewrites = new Map<string, ManifestRewrite>()
  for (const selection of validated) {
    const from = authored.get(selection.facetName)
    // An unchanged specifier is not a rewrite. Rendering `1.* → 1.*` for
    // every range selection would bury the handful of lines that do
    // change what the project declares.
    if (from === undefined || from === selection.manifestSource) continue
    rewrites.set(selection.facetName, { from, to: selection.manifestSource })
  }

  return { selected, rewrites }
}
