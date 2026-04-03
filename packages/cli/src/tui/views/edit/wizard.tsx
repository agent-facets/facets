import { useApp } from 'ink'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FocusModeProvider, useFocusMode } from '../../context/focus-mode-context.ts'
import { FocusOrderProvider, useFocusOrder } from '../../context/focus-order-context.ts'
import type { AssetSectionKey, FormState } from '../../context/form-state-context.ts'
import { FormStateProvider, useFormState } from '../../context/form-state-context.ts'
import { useExitKeys } from '../../hooks/use-exit-keys.ts'
import { useNavigationKeys } from '../../hooks/use-navigation-keys.ts'
import { EditConfirmView } from './edit-confirm-view.tsx'
import type { EditContext, EditResult, ReconciliationResolution } from './edit-types.ts'
import { EditView } from './edit-view.tsx'
import { manifestToFormState } from './manifest-to-form.ts'
import { ReconciliationView } from './reconciliation-view.tsx'
import { useEditSession } from './use-edit-session.ts'

type EditPhase = 'reconciliation' | 'editing' | 'confirmation'

export interface EditWizardSnapshot {
  phase: EditPhase
  formState?: FormState
  focusedId?: string | null
  resolutions: Map<string, ReconciliationResolution>
  selectedItem?: {
    section: AssetSectionKey
    name: string
    field: 'name' | 'description'
  }
}

export interface EditWizardProps {
  context: EditContext
  snapshot?: EditWizardSnapshot
  onComplete: (result: EditResult) => void
  onSnapshot?: (snapshot: EditWizardSnapshot) => void
  onRequestEditor?: (section: AssetSectionKey, name: string, description: string) => void
}

function EditWizardInner({ context, snapshot, onComplete, onSnapshot, onRequestEditor }: EditWizardProps) {
  const { exit } = useApp()
  const { setMode } = useFocusMode()
  const { form } = useFormState()
  const { focusedId, focus } = useFocusOrder()
  const hasReconciliation = context.reconciliationItems.length > 0

  const initialPhase = snapshot?.phase ?? (hasReconciliation ? 'reconciliation' : 'editing')
  const [phase, setPhase] = useState<EditPhase>(initialPhase)
  const { resolutions, resolve, buildResult } = useEditSession(context)

  // Report snapshot to parent for editor round-trips
  useEffect(() => {
    onSnapshot?.({ phase, formState: form, focusedId, resolutions })
  }, [phase, form, focusedId, resolutions, onSnapshot])

  const cancel = useCallback(() => {
    onComplete({ outcome: 'cancelled' })
    exit()
  }, [onComplete, exit])

  useExitKeys(cancel)
  useNavigationKeys()

  const handleEditDescription = useCallback(
    (section: AssetSectionKey, name: string) => {
      const description = form.assets[section].descriptions[name] ?? ''
      onRequestEditor?.(section, name, description)
    },
    [form, onRequestEditor],
  )

  const handleConfirm = useCallback(() => {
    onComplete(buildResult(form))
    exit()
  }, [form, buildResult, onComplete, exit])

  if (phase === 'reconciliation') {
    return (
      <ReconciliationView
        items={context.reconciliationItems}
        resolutions={resolutions}
        onResolve={resolve}
        onContinue={() => setPhase('editing')}
      />
    )
  }

  if (phase === 'editing') {
    return (
      <EditView
        onSubmit={() => {
          setPhase('confirmation')
          setMode('form-confirmation')
        }}
        onEditDescription={handleEditDescription}
      />
    )
  }

  if (phase === 'confirmation') {
    return (
      <EditConfirmView
        onConfirm={handleConfirm}
        onBack={() => {
          setPhase('editing')
          setMode('form-navigation')
          focus('edit-confirm-btn')
        }}
      />
    )
  }

  return null
}

export function EditWizard(props: EditWizardProps) {
  const initialFormState = useMemo(
    () => props.snapshot?.formState ?? manifestToFormState(props.context.manifest),
    [props.snapshot?.formState, props.context.manifest],
  )

  return (
    <FocusModeProvider>
      <FocusOrderProvider initialFocusId={props.snapshot?.focusedId}>
        <FormStateProvider initialState={initialFormState}>
          <EditWizardInner {...props} />
        </FormStateProvider>
      </FocusOrderProvider>
    </FocusModeProvider>
  )
}
