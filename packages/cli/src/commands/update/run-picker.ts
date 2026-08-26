import type { NonEmptyArray } from '@agent-facets/common'
import type { FacetUpdateSelection } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import { UpdatePicker } from './picker.tsx'
import type { UpdateCandidate, UpdateMode } from './selection.ts'

/**
 * What the user decided, or why they were never asked.
 *
 * Cancellation is its own arm rather than an empty selection: an empty
 * confirm is unrepresentable, so `[]` would only ever mean "cancelled",
 * and a caller reading it as "nothing to do" would report success for a
 * run the user abandoned.
 *
 * `unavailable` is separate from `cancelled` for the same reason in the
 * other direction. A screen that could not be shown is not a decision,
 * and reporting a crashed mount as "the user pressed Esc" would put a
 * defect behind a message that says everything went fine.
 */
export type UpdatePickerOutcome =
  | { kind: 'confirmed'; selections: NonEmptyArray<FacetUpdateSelection> }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; cause: string }

/**
 * Mount the picker, wait for it, and hand back what the user decided.
 *
 * Ctrl-C is handled inside the component rather than by Ink, so the
 * mount always unwinds through the same path and the caller always gets
 * an outcome. The mount itself is guarded because `render` enters raw
 * mode: stdin can be taken away between the command's terminal check and
 * this call, and the resulting throw would otherwise leave the command
 * boundary as an unexplained exit 2.
 */
export async function runUpdatePicker(
  candidates: NonEmptyArray<UpdateCandidate>,
  mode: UpdateMode,
): Promise<UpdatePickerOutcome> {
  const state: { outcome: UpdatePickerOutcome } = { outcome: { kind: 'cancelled' } }

  let instance: ReturnType<typeof render>
  try {
    instance = render(
      createElement(UpdatePicker, {
        candidates,
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
  } catch (err) {
    return { kind: 'unavailable', cause: describeCause(err) }
  }

  try {
    await instance.waitUntilExit()
  } catch (err) {
    // A render error inside the picker. The user made no choice, so the
    // only honest report is that the screen failed.
    return { kind: 'unavailable', cause: describeCause(err) }
  } finally {
    instance.unmount()
  }

  return state.outcome
}

function describeCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
