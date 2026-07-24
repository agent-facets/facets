import type { ScaffoldOptions as CreateOptions } from '@agent-facets/engine'
import { render } from 'ink'
import { openInEditorSync } from '../../tui/editor.ts'
import type { EditorRequest, WizardSnapshot } from '../../tui/views/create/wizard.tsx'
import { CreateWizard } from '../../tui/views/create/wizard.tsx'

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
          onRequestEditor={(request) => {
            pendingEditor = request
            instance.clear()
            instance.unmount()
          }}
        />,
      )

      instance.waitUntilExit().then(() => resolve())
    })

    if (pendingEditor && snapshot) {
      const req: EditorRequest = pendingEditor
      snapshot = mergeEditorResult(snapshot, req)
    } else {
      done = true
    }
  }

  return completed
}

/**
 * Open the external editor for one request and merge its result back into the
 * wizard snapshot. Asset descriptions are trimmed (single-line semantics);
 * README content is stored verbatim and marked authored so later identity edits
 * never regenerate it.
 */
function mergeEditorResult(snapshot: WizardSnapshot, req: EditorRequest): WizardSnapshot {
  if (req.kind === 'asset-description') {
    const edited = openInEditorSync(req.content, `${req.name}.md`)
    const section = snapshot.form.assets[req.section]
    return {
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
  // README: preserve exact author bytes; mark authored so it is never re-seeded.
  const edited = openInEditorSync(req.content, 'README.md')
  return {
    ...snapshot,
    selectedItem: undefined,
    form: {
      ...snapshot.form,
      readme: {
        ...snapshot.form.readme,
        ...(edited !== null ? { draft: { origin: 'authored' as const, content: edited } } : {}),
      },
    },
  }
}
