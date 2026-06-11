import type { ScaffoldOptions as CreateOptions } from '@agent-facets/engine'
import { render } from 'ink'
import type { AssetSectionKey } from '../../tui/context/form-state-context.ts'
import { openInEditorSync } from '../../tui/editor.ts'
import type { WizardSnapshot } from '../../tui/views/create/wizard.tsx'
import { CreateWizard } from '../../tui/views/create/wizard.tsx'

interface EditorRequest {
  section: AssetSectionKey
  name: string
  description: string
}

export interface RunCreateWizardOptions {
  /** Write the scaffold to disk and return the list of created file paths. */
  onScaffold: (opts: CreateOptions) => Promise<string[]>
  /** Argument suffix for the "facet build" hint (e.g. " my-dir" or ""). */
  buildArg: string
}

/**
 * Run the create wizard. Returns `true` if the scaffold was written
 * (success), `false` if the user cancelled.
 */
export async function runCreateWizardInk(options: RunCreateWizardOptions): Promise<boolean> {
  let completed = false
  let snapshot: WizardSnapshot | undefined
  let pendingEditor: EditorRequest | null = null
  let done = false

  while (!done) {
    pendingEditor = null

    await new Promise<void>((resolve) => {
      const instance = render(
        <CreateWizard
          snapshot={snapshot}
          onScaffold={options.onScaffold}
          buildArg={options.buildArg}
          onComplete={() => {
            completed = true
          }}
          onCancel={() => {
            completed = false
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
        const section = snapshot.form.assets[req.section]
        snapshot = {
          ...snapshot,
          selectedItem: undefined,
          form: {
            ...snapshot.form,
            assets: {
              ...snapshot.form.assets,
              [req.section]: {
                ...section,
                descriptions: {
                  ...section.descriptions,
                  ...(edited !== null ? { [req.name]: edited.trim() } : {}),
                },
              },
            },
          },
        }
      }
    } else {
      done = true
    }
  }

  return completed
}
