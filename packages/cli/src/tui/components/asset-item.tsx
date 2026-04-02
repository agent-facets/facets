import { Box, Text, useInput } from 'ink'
import { THEME } from '../theme.ts'

export function AssetItem({
  name,
  isFocused,
  onSelect,
  onRemove,
}: {
  id: string
  name: string
  isFocused: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  useInput(
    (_input, key) => {
      if (key.return) {
        onSelect()
      }
      if (key.delete || key.backspace) {
        onRemove()
      }
    },
    { isActive: isFocused },
  )

  return (
    <Box gap={1} marginLeft={2}>
      {isFocused ? (
        <>
          <Text color={THEME.primary} bold>
            ▸
          </Text>
          <Text color={THEME.primary}>{name}</Text>
          <Text color={THEME.hint}>
            <Text color={THEME.keyword}>Enter</Text> edit · <Text color={THEME.keyword}>Del</Text> remove
          </Text>
        </>
      ) : (
        <>
          <Text color={THEME.success}>•</Text>
          <Text>{name}</Text>
        </>
      )}
    </Box>
  )
}
