import type { ScaffoldOptions as CreateOptions } from '@agent-facets/engine'
import { useApp } from 'ink'
import { useCallback, useEffect, useState } from 'react'
import { FocusModeProvider, useFocusMode } from '../../context/focus-mode-context.ts'
import { FocusOrderProvider, useFocusOrder } from '../../context/focus-order-context.ts'
import type { AssetSectionKey, FormState } from '../../context/form-state-context.ts'
import { FormStateProvider, useFormState } from '../../context/form-state-context.ts'
import { useExitKeys } from '../../hooks/use-exit-keys.ts'
import { useNavigationKeys } from '../../hooks/use-navigation-keys.ts'
import { ConfirmView } from './confirm-view.tsx'
import { CreateView } from './create-view.tsx'
import { CreateSuccessView } from './success-view.tsx'

export interface WizardSnapshot {
  form: FormState
  focusedId: string | null
  selectedItem?: {
    section: AssetSectionKey
    name: string
    field: 'name' | 'description'
  }
}

/**
 * An external-editor round-trip request. Tagged so an asset-description edit and
 * a README-body edit cannot be confused: each arm carries exactly the content
 * that must be handed to the editor and merged back on return.
 */
export type EditorRequest =
  | { kind: 'asset-description'; section: AssetSectionKey; name: string; content: string }
  | { kind: 'readme'; content: string }

export interface CreateWizardProps {
  onComplete: (opts: CreateOptions) => void
  onCancel: () => void
  /** Write the scaffold to disk and return the list of created file paths. */
  onScaffold?: (opts: CreateOptions) => Promise<string[]>
  /** Argument suffix for the "facet build" hint (e.g. " my-dir" or ""). */
  buildArg?: string
  snapshot?: WizardSnapshot
  onSnapshot?: (snapshot: WizardSnapshot) => void
  onRequestEditor?: (request: EditorRequest) => void
}

type Phase = 'editing' | 'confirming' | 'done'

function CreateWizardInner({
  onComplete,
  onCancel,
  onScaffold,
  buildArg = '',
  snapshot,
  onSnapshot,
  onRequestEditor,
}: CreateWizardProps) {
  const { exit } = useApp()
  const { setMode } = useFocusMode()
  const { form, toCreateOptions } = useFormState()
  const { focusedId } = useFocusOrder()

  const [phase, setPhase] = useState<Phase>('editing')
  const [doneFiles, setDoneFiles] = useState<string[]>([])
  const [doneName, setDoneName] = useState('')

  // Keep the parent informed of current state for snapshot
  useEffect(() => {
    onSnapshot?.({ form, focusedId, selectedItem: snapshot?.selectedItem })
  }, [form, focusedId, onSnapshot, snapshot?.selectedItem])

  // Defer exit so React paints the success view before Ink unmounts.
  useEffect(() => {
    if (phase === 'done') {
      exit()
    }
  }, [phase, exit])

  const cancel = useCallback(() => {
    onCancel()
    exit()
  }, [onCancel, exit])

  useExitKeys(cancel)
  useNavigationKeys()

  const handleEditDescription = useCallback(
    (section: AssetSectionKey, name: string) => {
      const description = form.assets[section].descriptions[name] ?? ''
      onRequestEditor?.({ kind: 'asset-description', section, name, content: description })
    },
    [form, onRequestEditor],
  )

  const handleEditReadme = useCallback(() => {
    onRequestEditor?.({ kind: 'readme', content: form.readme.draft.content })
  }, [form, onRequestEditor])

  const handleConfirm = useCallback(async () => {
    const opts = toCreateOptions()
    onComplete(opts)
    if (onScaffold) {
      const files = await onScaffold(opts)
      setDoneName(opts.name)
      setDoneFiles(files)
      setPhase('done')
    } else {
      exit()
    }
  }, [toCreateOptions, onComplete, onScaffold, exit])

  if (phase === 'done') {
    return <CreateSuccessView name={doneName} files={doneFiles} buildArg={buildArg} />
  }

  if (phase === 'confirming') {
    return (
      <ConfirmView
        opts={toCreateOptions()}
        onConfirm={handleConfirm}
        onBack={() => {
          setPhase('editing')
          setMode('form-navigation')
        }}
      />
    )
  }

  return (
    <CreateView
      onSubmit={() => {
        setPhase('confirming')
        setMode('form-confirmation')
      }}
      onEditDescription={handleEditDescription}
      onEditReadme={handleEditReadme}
    />
  )
}

export function CreateWizard(props: CreateWizardProps) {
  return (
    <FocusModeProvider>
      <FocusOrderProvider initialFocusId={props.snapshot?.focusedId}>
        <FormStateProvider initialState={props.snapshot?.form}>
          <CreateWizardInner {...props} />
        </FormStateProvider>
      </FocusOrderProvider>
    </FocusModeProvider>
  )
}
