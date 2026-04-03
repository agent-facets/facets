import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { useFocusMode } from '../context/focus-mode-context.ts'
import { THEME } from '../theme.ts'

export type AssetField = 'name' | 'description'

export function AssetFieldPicker({
  name,
  description,
  initialField,
  onChoose,
  onCancel,
}: {
  name: string
  description: string
  initialField?: AssetField
  onChoose: (field: AssetField) => void
  onCancel: () => void
}) {
  const { setMode } = useFocusMode()
  const [field, setField] = useState<AssetField>(initialField ?? 'name')

  useEffect(() => {
    setMode('field-revision')
    return () => setMode('form-navigation')
  }, [setMode])

  useInput((_input, key) => {
    if (key.upArrow) setField('name')
    if (key.downArrow) setField('description')
    if (key.escape) onCancel()
    if (key.return) onChoose(field)
  })

  return (
    <Box flexDirection="column">
      <Box gap={1} marginLeft={2}>
        {field === 'name' ? (
          <>
            <Text color={THEME.primary} bold>
              ▸
            </Text>
            <Text color={THEME.primary}>{name}</Text>
            <Text color={THEME.hint}>
              <Text color={THEME.keyword}>↑↓</Text> select · <Text color={THEME.keyword}>Enter</Text> edit ·{' '}
              <Text color={THEME.keyword}>Esc</Text> back
            </Text>
          </>
        ) : (
          <>
            <Text color={THEME.success}>•</Text>
            <Text>{name}</Text>
          </>
        )}
      </Box>
      <Box gap={1} marginLeft={2}>
        {field === 'description' ? (
          <>
            <Text color={THEME.primary} bold>
              ▸
            </Text>
            <Text color={THEME.primary}>{description}</Text>
            <Text color={THEME.hint}>
              <Text color={THEME.keyword}>↑↓</Text> select · <Text color={THEME.keyword}>Enter</Text> edit ·{' '}
              <Text color={THEME.keyword}>Esc</Text> back
            </Text>
          </>
        ) : (
          <>
            <Text> </Text>
            <Text dimColor>{description}</Text>
          </>
        )}
      </Box>
    </Box>
  )
}
