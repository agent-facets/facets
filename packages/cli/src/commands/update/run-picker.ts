import type { FacetUpdateSelection, UpdatePlanRow } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import { UpdatePicker } from './picker.tsx'
import type { UpdateMode } from './selection.ts'

/**
 * Cancellation is its own arm, not an empty selection.
 *
 * An empty confirm is impossible — the picker refuses it — so `[]` would
 * only ever mean "cancelled", and a caller reading it as "nothing to do"
 * would report success for a run the user abandoned.
 */
export type UpdatePickerOutcome = { kind: 'confirmed'; selections: FacetUpdateSelection[] } | { kind: 'cancelled' }

/**
 * Mount the picker, wait for it, and hand back what the user decided.
 *
 * Ctrl-C is handled inside the component rather than by Ink, so the
 * mount always unwinds through the same path and the caller always gets
 * an outcome.
 */
export async function runUpdatePicker(plan: readonly UpdatePlanRow[], mode: UpdateMode): Promise<UpdatePickerOutcome> {
  const state: { outcome: UpdatePickerOutcome } = { outcome: { kind: 'cancelled' } }

  const instance = render(
    createElement(UpdatePicker, {
      plan,
      mode,
      onConfirm: (selections) => {
        state.outcome = { kind: 'confirmed', selections }
      },
      onAbort: () => {
        state.outcome = { kind: 'cancelled' }
      },
    }),
    { exitOnCtrlC: false },
  )

  try {
    await instance.waitUntilExit()
  } finally {
    instance.unmount()
  }

  return state.outcome
}
