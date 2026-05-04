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

export interface WizardSnapshot {
  form: FormState
  focusedId: string | null
  selectedItem?: {
    section: AssetSectionKey
    name: string
    field: 'name' | 'description'
  }
}

export interface CreateWizardProps {
  onComplete: (opts: CreateOptions) => void
  onCancel: () => void
  snapshot?: WizardSnapshot
  onSnapshot?: (snapshot: WizardSnapshot) => void
  onRequestEditor?: (section: AssetSectionKey, name: string, description: string) => void
}

function CreateWizardInner({ onComplete, onCancel, snapshot, onSnapshot, onRequestEditor }: CreateWizardProps) {
  const { exit } = useApp()
  const { setMode } = useFocusMode()
  const { form, toCreateOptions } = useFormState()
  const { focusedId } = useFocusOrder()

  const [confirming, setConfirming] = useState(false)

  // Keep the parent informed of current state for snapshot
  useEffect(() => {
    onSnapshot?.({ form, focusedId, selectedItem: snapshot?.selectedItem })
  }, [form, focusedId, onSnapshot, snapshot?.selectedItem])

  const cancel = useCallback(() => {
    onCancel()
    exit()
  }, [onCancel, exit])

  useExitKeys(cancel)
  useNavigationKeys()

  const handleEditDescription = useCallback(
    (section: AssetSectionKey, name: string) => {
      const description = form.assets[section].descriptions[name] ?? ''
      onRequestEditor?.(section, name, description)
    },
    [form, onRequestEditor],
  )

  if (confirming) {
    return (
      <ConfirmView
        opts={toCreateOptions()}
        onConfirm={() => {
          onComplete(toCreateOptions())
          exit()
        }}
        onBack={() => {
          setConfirming(false)
          setMode('form-navigation')
        }}
      />
    )
  }

  return (
    <CreateView
      onSubmit={() => {
        setConfirming(true)
        setMode('form-confirmation')
      }}
      onEditDescription={handleEditDescription}
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
