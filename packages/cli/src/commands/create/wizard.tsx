import { render } from 'ink'
import type { AssetSectionKey } from '../../tui/context/form-state-context.ts'
import { openInEditorSync } from '../../tui/editor.ts'
import type { WizardSnapshot } from '../../tui/views/create/wizard.tsx'
import { CreateWizard } from '../../tui/views/create/wizard.tsx'
import type { CreateOptions } from '../create-scaffold.ts'

interface EditorRequest {
  section: AssetSectionKey
  name: string
  description: string
}

export async function runCreateWizardInk(): Promise<CreateOptions | null> {
  let result: CreateOptions | null = null
  let snapshot: WizardSnapshot | undefined
  let pendingEditor: EditorRequest | null = null
  let done = false

  while (!done) {
    pendingEditor = null

    await new Promise<void>((resolve) => {
      const instance = render(
        <CreateWizard
          snapshot={snapshot}
          onComplete={(opts) => {
            result = opts
          }}
          onCancel={() => {
            result = null
          }}
          onSnapshot={(s) => {
            snapshot = s
          }}
          onRequestEditor={(section, name, description) => {
            pendingEditor = { section, name, description }
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

  return result
}
