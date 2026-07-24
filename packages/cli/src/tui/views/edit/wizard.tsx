import type {
  EditContext,
  EditOperation,
  EditResult,
  ReadmeAction,
  ReadmeActionOption,
  ReadmePath,
} from '@agent-facets/engine'
import { readmeActionFor, readmeSeedContent } from '@agent-facets/engine'
import { useApp } from 'ink'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FocusModeProvider, useFocusMode } from '../../context/focus-mode-context.ts'
import { FocusOrderProvider, useFocusOrder } from '../../context/focus-order-context.ts'
import type { AssetSectionKey, FormState } from '../../context/form-state-context.ts'
import { FormStateProvider, useFormState } from '../../context/form-state-context.ts'
import { useExitKeys } from '../../hooks/use-exit-keys.ts'
import { useNavigationKeys } from '../../hooks/use-navigation-keys.ts'
import { EditConfirmView } from './edit-confirm-view.tsx'
import { EditView } from './edit-view.tsx'
import { manifestToFormState } from './manifest-to-form.ts'
import { ReadmePanelView } from './readme-panel-view.tsx'
import { ReconciliationView } from './reconciliation-view.tsx'
import { EditSuccessView } from './success-view.tsx'
import { type ResolvedItem, useEditSession } from './use-edit-session.ts'

type EditPhase = 'reconciliation' | 'readme' | 'editing' | 'confirmation' | 'done'

/**
 * An external-editor round-trip request. Tagged so an asset-description edit and
 * a README-body edit cannot be confused: each arm carries exactly the content
 * handed to the editor, and the README arm carries the exact path and chosen
 * option so the returned bytes become the right tagged action on that path.
 */
export type EditEditorRequest =
  | { kind: 'asset-description'; section: AssetSectionKey; name: string; content: string }
  | { kind: 'readme'; path: ReadmePath; option: ReadmeActionOption; content: string }

export interface EditWizardSnapshot {
  phase: EditPhase
  formState?: FormState
  focusedId?: string | null
  resolutions: Map<string, ResolvedItem>
  /** Queued README actions per conventional path; survives editor round-trips. */
  readmeActions: Map<ReadmePath, ReadmeAction>
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
  /** Apply edit operations to disk. Called before the success view renders. */
  onApply?: (result: EditResult & { outcome: 'applied' }) => Promise<void>
  /** Argument suffix for the "facet build" hint (e.g. " my-dir" or ""). */
  buildArg?: string
  onSnapshot?: (snapshot: EditWizardSnapshot) => void
  onRequestEditor?: (request: EditEditorRequest) => void
}

function EditWizardInner({
  context,
  snapshot,
  onComplete,
  onApply,
  buildArg = '',
  onSnapshot,
  onRequestEditor,
}: EditWizardProps) {
  const { exit } = useApp()
  const { setMode } = useFocusMode()
  const { form } = useFormState()
  const { focusedId, focus } = useFocusOrder()
  const hasReconciliation = context.reconciliationItems.length > 0

  const initialPhase = snapshot?.phase ?? (hasReconciliation ? 'reconciliation' : 'readme')
  const [phase, setPhase] = useState<EditPhase>(initialPhase)
  const [doneOperations, setDoneOperations] = useState<EditOperation[]>([])
  // Seed from the snapshot so resolutions and README actions survive
  // external-editor round-trips (which unmount and remount the wizard).
  const { resolutions, resolve, readmeActions, resolveReadme, buildResult } = useEditSession(
    context,
    snapshot?.resolutions,
    snapshot?.readmeActions,
  )

  // Report snapshot to parent for editor round-trips
  useEffect(() => {
    if (phase !== 'done') {
      onSnapshot?.({ phase, formState: form, focusedId, resolutions, readmeActions })
    }
  }, [phase, form, focusedId, resolutions, readmeActions, onSnapshot])

  // Defer exit so React paints the success view before Ink unmounts.
  useEffect(() => {
    if (phase === 'done') {
      exit()
    }
  }, [phase, exit])

  const cancel = useCallback(() => {
    onComplete({ outcome: 'cancelled' })
    exit()
  }, [onComplete, exit])

  useExitKeys(cancel)
  useNavigationKeys()

  const handleEditDescription = useCallback(
    (section: AssetSectionKey, name: string) => {
      const description = form.assets[section].descriptions[name] ?? ''
      onRequestEditor?.({ kind: 'asset-description', section, name, content: description })
    },
    [form, onRequestEditor],
  )

  // Non-content README choices queue immediately; content choices route to the
  // external editor and are applied when the round-trip returns (see command
  // runner). `scaffold` writes bytes without an editor, so it is seeded from the
  // facet identity template here; declaration-only actions ignore the content.
  const handleReadmeResolve = useCallback(
    (path: ReadmePath, option: ReadmeActionOption) => {
      const state = context.readme.find((s) => s.path === path)
      const seed = state ? readmeSeedContent(state, form.fields.name.value, form.fields.description.value) : ''
      resolveReadme(path, readmeActionFor(option.kind, seed))
    },
    [context.readme, form.fields.name.value, form.fields.description.value, resolveReadme],
  )

  const handleReadmeEdit = useCallback(
    (path: ReadmePath, option: ReadmeActionOption) => {
      const state = context.readme.find((s) => s.path === path)
      const seed = state?.state === 'present-declared' || state?.state === 'present-undeclared' ? state.content : ''
      onRequestEditor?.({ kind: 'readme', path, option, content: seed })
    },
    [context.readme, onRequestEditor],
  )

  const handleConfirm = useCallback(async () => {
    const result = buildResult(form)
    onComplete(result)
    if (onApply && result.outcome === 'applied') {
      await onApply(result)
      setDoneOperations(result.operations)
      setPhase('done')
    } else {
      exit()
    }
  }, [form, buildResult, onComplete, onApply, exit])

  if (phase === 'done') {
    return <EditSuccessView operations={doneOperations} buildArg={buildArg} />
  }

  if (phase === 'reconciliation') {
    return (
      <ReconciliationView
        items={context.reconciliationItems}
        resolutions={resolutions}
        onResolve={resolve}
        onContinue={() => setPhase('readme')}
      />
    )
  }

  if (phase === 'readme') {
    return (
      <ReadmePanelView
        states={context.readme}
        actions={readmeActions}
        onResolve={handleReadmeResolve}
        onEditReadme={handleReadmeEdit}
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
    const pending = buildResult(form)
    const operations = pending.outcome === 'applied' ? pending.operations : []
    return (
      <EditConfirmView
        operations={operations}
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
