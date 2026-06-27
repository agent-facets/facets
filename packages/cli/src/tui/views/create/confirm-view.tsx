import { ASSET_TYPE_COLORS } from '@agent-facets/brand'
import { type ScaffoldOptions as CreateOptions, previewScaffoldFiles } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import { useEffect } from 'react'
import { truncateDescription } from '../../components/asset-description.tsx'
import { Button } from '../../components/button.tsx'
import { useFocusOrder } from '../../context/focus-order-context.ts'
import type { AssetSectionKey } from '../../context/form-state-context.ts'
import { useFormState } from '../../context/form-state-context.ts'
import { WizardLayout } from '../../layouts/wizard-layout.tsx'
import { THEME } from '../../theme.ts'

const ASSET_TYPES: AssetSectionKey[] = ['skill', 'command', 'agent']
const ASSET_LABELS: Record<AssetSectionKey, string> = {
  skill: 'Skills',
  command: 'Commands',
  agent: 'Agents',
}

export function ConfirmView({
  opts,
  onConfirm,
  onBack,
}: {
  opts: CreateOptions
  onConfirm: () => void
  onBack: () => void
}) {
  const files = previewScaffoldFiles(opts)
  const { form } = useFormState()
  const { setFocusIds, focus, focusedId } = useFocusOrder()

  useEffect(() => {
    setFocusIds(['confirm-yes', 'confirm-no'])
    focus('confirm-yes')
  }, [setFocusIds, focus])

  return (
    <WizardLayout>
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>Name:</Text>
          <Text>{form.fields.name.value || '(none)'}</Text>
        </Box>
        <Box gap={1}>
          <Text bold>Description:</Text>
          <Text>{truncateDescription(form.fields.description.value || '(none)')}</Text>
        </Box>
        <Box gap={1}>
          <Text bold>Version:</Text>
          <Text>{form.fields.version.value || '(none)'}</Text>
        </Box>
        <Box gap={1}>
          <Text bold>Privacy:</Text>
          <Text color={form.private ? THEME.warning : THEME.success}>{form.private ? 'Private' : 'Public'}</Text>
        </Box>
      </Box>

      {ASSET_TYPES.map((type) => {
        const section = form.assets[type]
        return (
          <Box key={type} flexDirection="column">
            <Text bold>{ASSET_LABELS[type]}:</Text>
            {section.items.length === 0 ? (
              <Box marginLeft={2}>
                <Text dimColor>(none)</Text>
              </Box>
            ) : (
              section.items.map((item) => {
                const desc = section.descriptions[item] ?? `A ${item} ${type}`
                return (
                  <Box key={item} flexDirection="column" marginLeft={2}>
                    <Box gap={1}>
                      <Text color={ASSET_TYPE_COLORS[type]}>●</Text>
                      <Text>{item}</Text>
                    </Box>
                    <Box marginLeft={3}>
                      <Text dimColor>{truncateDescription(desc)}</Text>
                    </Box>
                  </Box>
                )
              })
            )}
          </Box>
        )
      })}

      <Box flexDirection="column" marginTop={1}>
        <Text bold color={THEME.success}>
          Files to create:
        </Text>
        {files.map((f) => (
          <Box key={f} marginLeft={2}>
            <Text color={THEME.hint}>{f}</Text>
          </Box>
        ))}
      </Box>

      <Box gap={2} marginTop={1}>
        <Button
          id="confirm-yes"
          label="[ Yes, create ]"
          color={THEME.success}
          gradient={focusedId === 'confirm-yes'}
          animateGradient={focusedId === 'confirm-yes'}
          onPress={onConfirm}
        />
        <Button id="confirm-no" label="[ No, go back ]" color={THEME.warning} onPress={onBack} />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>← → to switch, Enter to confirm</Text>
      </Box>
    </WizardLayout>
  )
}
