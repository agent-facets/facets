import type { EditContext, EditResult } from '@agent-facets/engine'
import { readmeActionFor } from '@agent-facets/engine'
import { render } from 'ink'
import { openInEditorSync } from '../../tui/editor.ts'
import type { EditEditorRequest, EditWizardSnapshot } from '../../tui/views/edit/wizard.tsx'
import { EditWizard } from '../../tui/views/edit/wizard.tsx'

export interface RunEditWizardOptions {
  /** Apply edit operations to disk. */
  onApply: (result: EditResult & { outcome: 'applied' }) => Promise<void>
  /** Argument suffix for the "facet build" hint (e.g. " my-dir" or ""). */
  buildArg: string
}

/**
 * Run the edit wizard. Returns `true` if changes were applied (success),
 * `false` if the user cancelled.
 */
export async function runEditWizardInk(context: EditContext, options: RunEditWizardOptions): Promise<boolean> {
  let completed = false
  let snapshot: EditWizardSnapshot | undefined
  let pendingEditor: EditEditorRequest | null = null
  let done = false

  while (!done) {
    pendingEditor = null

    await new Promise<void>((resolve) => {
      const instance = render(
        <EditWizard
          context={context}
          snapshot={snapshot}
          onApply={options.onApply}
          buildArg={options.buildArg}
          onComplete={(r) => {
            completed = r.outcome === 'applied'
          }}
          onSnapshot={(s) => {
            snapshot = s
          }}
          onRequestEditor={(request) => {
            pendingEditor = request
            instance.clear()
            instance.unmount()
          }}
        />,
      )

      instance.waitUntilExit().then(() => resolve())
    })

    if (pendingEditor) {
      snapshot = applyEditorRoundTrip(pendingEditor, snapshot)
    } else {
      done = true
    }
  }

  return completed
}

/**
 * Open the external editor for a pending request and fold the result back into
 * the wizard snapshot so the re-rendered wizard sees the edit. Asset-description
 * edits update the form; README edits become the chosen tagged action on the
 * exact path (bytes discarded → no action, so a cancelled editor leaves the
 * path untouched rather than queuing empty content).
 */
function applyEditorRoundTrip(
  request: EditEditorRequest,
  snapshot: EditWizardSnapshot | undefined,
): EditWizardSnapshot | undefined {
  if (!snapshot) return snapshot

  if (request.kind === 'asset-description') {
    const edited = openInEditorSync(request.content, `${request.name}.md`)
    return {
      ...snapshot,
      selectedItem: undefined,
      formState: snapshot.formState
        ? {
            ...snapshot.formState,
            assets: {
              ...snapshot.formState.assets,
              [request.section]: {
                ...snapshot.formState.assets[request.section],
                descriptions: {
                  ...snapshot.formState.assets[request.section].descriptions,
                  ...(edited !== null ? { [request.name]: edited.trim() } : {}),
                },
              },
            },
          }
        : undefined,
    }
  }

  // README content edit: seed the editor with the request content, then queue
  // the tagged action for this path. A cancelled editor (null) queues nothing.
  const edited = openInEditorSync(request.content, request.path)
  if (edited === null) return { ...snapshot, selectedItem: undefined }
  const nextReadme = new Map(snapshot.readmeActions)
  nextReadme.set(request.path, readmeActionFor(request.option.kind, edited))
  return { ...snapshot, selectedItem: undefined, readmeActions: nextReadme }
}
