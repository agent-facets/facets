import type { FacetOutcome, FacetStage, RunInstallFailure } from '@agent-facets/engine'

/**
 * Per-facet display state accumulated by `<InstallView />` while an install
 * runs.
 *
 *   - `stage` is set while a stage event is in flight (no outcome or
 *     failure yet), and drives the progress line's label.
 *   - `outcome` is set on success (`facet-success`).
 *   - `failure` is set on rejection (`facet-failure`).
 *
 * The view renders ONE live progress line and then a summary block, rather
 * than a row per facet: the per-facet detail a reader needs after the fact
 * (aliases, retained files, failures) is carried by the summary, and a
 * scrolling row list competes with the progress bar for the same lines.
 */
export interface FacetState {
  name: string
  specifier: string
  stage: FacetStage | null
  outcome: FacetOutcome | null
  failure: RunInstallFailure | null
}

export const STAGE_LABELS: Record<FacetStage, string> = {
  parse: 'parsing',
  resolve: 'resolving',
  fetch: 'fetching',
  verify: 'verifying',
  load: 'loading manifest',
  build: 'building',
  materialize: 'materializing',
}
