import { ASSET_TYPE_COLORS } from '@agent-facets/brand'
import { Box, Text } from 'ink'
import { useEffect } from 'react'
import { truncateDescription } from '../../components/asset-description.tsx'
import { Button } from '../../components/button.tsx'
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

export function EditConfirmView({ onConfirm, onBack }: { onConfirm: () => void; onBack: () => void }) {
  const { form } = useFormState()
  const { setFocusIds, focus, focusedId } = useFocusOrder()

  useEffect(() => {
    setFocusIds(['edit-apply-btn', 'edit-back-btn'])
    focus('edit-apply-btn')
  }, [setFocusIds, focus])

  return (
    <Box flexDirection="column">
      <Text bold color={THEME.brand}>
        Review changes
      </Text>

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

      <Box marginTop={1} gap={2}>
        <Button
          id="edit-apply-btn"
          label="[ Yes, apply ]"
          color={THEME.success}
          gradient={focusedId === 'edit-apply-btn'}
          animateGradient={focusedId === 'edit-apply-btn'}
          onPress={onConfirm}
        />
        <Button id="edit-back-btn" label="[ No, go back ]" color={THEME.warning} onPress={onBack} />
      </Box>

      <Box>
        <Text dimColor>← → switch · Enter confirm</Text>
      </Box>
    </Box>
  )
}
