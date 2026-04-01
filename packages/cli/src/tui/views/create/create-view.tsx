import { Box, Text } from 'ink'
import { useCallback, useEffect } from 'react'
import { ASSET_LABELS, ASSET_TYPES } from '../../../commands/create/types.ts'
import { DEFAULT_VERSION, isValidKebabCase } from '../../../commands/create-scaffold.ts'
import { AssetSection } from '../../components/asset-section.tsx'
import { Button } from '../../components/button.tsx'
import { EditableField } from '../../components/editable-field.tsx'
import { useFocusOrder } from '../../context/focus-order-context.ts'
import { useFormState } from '../../context/form-state-context.ts'
import { WizardLayout } from '../../layouts/wizard-layout.tsx'

function computeFocusIds(form: ReturnType<typeof useFormState>['form']): string[] {
  const ids: string[] = ['field-name', 'field-description', 'field-version']

  for (const type of ASSET_TYPES) {
    const section = form.assets[type]

    for (let i = 0; i < section.items.length; i++) {
      ids.push(`item-${type}-${i}`)
    }

    ids.push(`add-${type}`)
  }

  ids.push('create-btn')

  return ids
}

export function CreateView({ onSubmit }: { onSubmit: () => void }) {
  const { form } = useFormState()
  const { setFocusIds, focus, focusedId } = useFocusOrder()

  const validateKebab = useCallback((v: string) => {
    if (!v) return undefined
    if (!isValidKebabCase(v)) return 'Must be kebab-case (e.g., my-facet)'
    return undefined
  }, [])

  // Derived state from context
  const nameConfirmed = form.fields.name.status === 'confirmed'
  const descriptionConfirmed = form.fields.description.status === 'confirmed'
  const versionConfirmed = form.fields.version.status === 'confirmed'

  // Settled = confirmed or has a value (being revised). Used for dimming.
  const nameSettled = nameConfirmed || !!form.fields.name.value
  const descriptionSettled = descriptionConfirmed || !!form.fields.description.value
  const versionSettled = versionConfirmed || !!form.fields.version.value

  const descriptionReady = nameSettled
  const versionReady = nameSettled && descriptionSettled
  const assetsReady = nameSettled && descriptionSettled && versionSettled

  const canCreate = assetsReady

  // Recompute focus order
  useEffect(() => {
    const ids = computeFocusIds(form)
    setFocusIds(ids)

    if (focusedId && !ids.includes(focusedId)) {
      focus(ids[0] ?? '')
    }
  }, [form, setFocusIds, focus, focusedId])

  // Auto-focus name field on mount
  useEffect(() => {
    if (!focusedId) {
      focus('field-name')
    }
  }, [focusedId, focus])

  return (
    <WizardLayout>
      <EditableField
        field="name"
        label="Name"
        placeholder="my-facet"
        hint="kebab-case"
        validate={validateKebab}
        onConfirm={() => focus('field-description')}
      />

      <EditableField
        field="description"
        label="Description"
        placeholder="A brief description of what this facet does"
        dimmed={!descriptionReady}
        onConfirm={() => focus('field-version')}
      />

      <EditableField
        field="version"
        label="Version"
        hint="SemVer N.N.N"
        defaultValue={DEFAULT_VERSION}
        dimmed={!versionReady}
        validate={(v) => (/^\d+\.\d+\.\d+$/.test(v) ? undefined : `Must be SemVer (e.g., ${DEFAULT_VERSION})`)}
        onConfirm={() => focus(`add-${ASSET_TYPES[0]}`)}
      />

      {ASSET_TYPES.map((type) => (
        <Box key={type} marginTop={0}>
          <AssetSection
            section={type}
            label={ASSET_LABELS[type]}
            defaultName={form.assets[type].items.length === 0 ? form.fields.name.value : undefined}
            dimmed={!assetsReady}
            validate={(v) => {
              if (!isValidKebabCase(v)) return 'Must be kebab-case'
              const editing = form.assets[type].editing
              if (form.assets[type].items.some((item) => item === v && item !== editing)) return `"${v}" already exists`
              return undefined
            }}
          />
        </Box>
      ))}

      <Box marginTop={1}>
        <Button
          id="create-btn"
          label="[ Create facet ]"
          color="green"
          disabled={!canCreate}
          gradient={canCreate}
          animateGradient={canCreate && focusedId === 'create-btn'}
          onPress={onSubmit}
        />
      </Box>

      {!canCreate && (
        <Box marginLeft={2}>
          <Text dimColor>
            {!nameConfirmed
              ? 'Enter a name to continue'
              : !descriptionConfirmed
                ? 'Enter a description to continue'
                : 'Enter a version to continue'}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑ ↓ to navigate, Enter to select/edit, Esc Esc to exit</Text>
      </Box>
    </WizardLayout>
  )
}
