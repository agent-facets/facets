import type { EditContext, EditResult } from '@agent-facets/engine'
import { render } from 'ink'
import type { AssetSectionKey } from '../../tui/context/form-state-context.ts'
import { openInEditorSync } from '../../tui/editor.ts'
import type { EditWizardSnapshot } from '../../tui/views/edit/wizard.tsx'
import { EditWizard } from '../../tui/views/edit/wizard.tsx'

interface EditorRequest {
  section: AssetSectionKey
  name: string
  description: string
}

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
  let pendingEditor: EditorRequest | null = null
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
          onRequestEditor={(section, name, description) => {
            pendingEditor = { section, name, description }
            instance.clear()
            instance.unmount()
          }}
        />,
      )

      instance.waitUntilExit().then(() => resolve())
    })

    if (pendingEditor) {
      const req = pendingEditor as EditorRequest
      const edited = openInEditorSync(req.description, `${req.name}.md`)
      if (snapshot) {
        snapshot = {
          ...snapshot,
          selectedItem: undefined,
          formState: snapshot.formState
            ? {
                ...snapshot.formState,
                assets: {
                  ...snapshot.formState.assets,
                  [req.section]: {
                    ...snapshot.formState.assets[req.section],
                    descriptions: {
                      ...snapshot.formState.assets[req.section].descriptions,
                      ...(edited !== null ? { [req.name]: edited.trim() } : {}),
                    },
                  },
                },
              }
            : undefined,
        }
      }
    } else {
      done = true
    }
  }

  return completed
}
