import { DEFAULT_VERSION, isValidKebabCase } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import { useCallback, useEffect } from 'react'
import { AssetSection } from '../../components/asset-section.tsx'
import { Button } from '../../components/button.tsx'
import { EditableField } from '../../components/editable-field.tsx'
import { useFocusOrder } from '../../context/focus-order-context.ts'
import type { AssetSectionKey } from '../../context/form-state-context.ts'
import { useFormState } from '../../context/form-state-context.ts'
import { THEME } from '../../theme.ts'

const ASSET_TYPES: AssetSectionKey[] = ['skill', 'command', 'agent']
const ASSET_LABELS: Record<AssetSectionKey, string> = {
  skill: 'Skills',
  command: 'Commands',
  agent: 'Agents',
}

function computeFocusIds(form: ReturnType<typeof useFormState>['form']): string[] {
  const ids: string[] = ['field-name', 'field-description', 'field-version']

  for (const type of ASSET_TYPES) {
    const section = form.assets[type]

    for (let i = 0; i < section.items.length; i++) {
      ids.push(`item-${type}-${i}`)
    }

    ids.push(`add-${type}`)
  }

  ids.push('edit-confirm-btn')
  return ids
}

export function EditView({
  onSubmit,
  onEditDescription,
}: {
  onSubmit: () => void
  onEditDescription?: (section: AssetSectionKey, name: string) => void
}) {
  const { form } = useFormState()
  const { setFocusIds, focus, focusedId } = useFocusOrder()

  const validateKebab = useCallback((v: string) => {
    if (!v) return undefined
    if (!isValidKebabCase(v)) return 'Must be kebab-case (e.g., my-facet)'
    return undefined
  }, [])

  useEffect(() => {
    const ids = computeFocusIds(form)
    setFocusIds(ids)

    if (focusedId && !ids.includes(focusedId)) {
      focus(ids[0] ?? '')
    }
  }, [form, setFocusIds, focus, focusedId])

  const totalAssets = form.assets.skill.items.length + form.assets.agent.items.length + form.assets.command.items.length
  const canConfirm = totalAssets > 0

  useEffect(() => {
    if (!focusedId) {
      focus('field-name')
    }
  }, [focusedId, focus])

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color={THEME.brand}>
        Edit facet
      </Text>

      <Box flexDirection="column">
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
          placeholder="A brief description"
          onConfirm={() => focus('field-version')}
        />

        <EditableField
          field="version"
          label="Version"
          hint="SemVer N.N.N"
          validate={(v) => (/^\d+\.\d+\.\d+$/.test(v) ? undefined : `Must be SemVer (e.g., ${DEFAULT_VERSION})`)}
          onConfirm={() => focus(`add-${ASSET_TYPES[0]}`)}
        />
      </Box>

      {ASSET_TYPES.map((type) => (
        <Box key={type} marginTop={0}>
          <AssetSection
            section={type}
            label={ASSET_LABELS[type]}
            onEditDescription={onEditDescription}
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
          id="edit-confirm-btn"
          label="[ Review & Confirm ]"
          disabled={!canConfirm}
          gradient={canConfirm}
          animateGradient={canConfirm && focusedId === 'edit-confirm-btn'}
          onPress={onSubmit}
        />
      </Box>

      {!canConfirm && (
        <Box marginLeft={2}>
          <Text dimColor>Add at least one skill, agent, or command</Text>
        </Box>
      )}

      <Box>
        <Text dimColor>↑ ↓ navigate · Enter edit · Esc Esc exit (no changes)</Text>
      </Box>
    </Box>
  )
}
