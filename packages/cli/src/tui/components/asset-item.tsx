import { Box, Text, useInput } from 'ink'
import { THEME } from '../theme.ts'

export function AssetItem({
  name,
  bulletColor,
  isFocused,
  onEdit,
  onRemove,
}: {
  id: string
  name: string
  /** Color for the bullet dot when unfocused. */
  bulletColor?: string
  isFocused: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  useInput(
    (_input, key) => {
      if (key.return) onEdit()
      if (key.delete || key.backspace) onRemove()
    },
    { isActive: isFocused },
  )

  return (
    <Box gap={1}>
      {isFocused ? (
        <>
          <Text color={THEME.focus} bold>
            ▸
          </Text>
          <Text color={THEME.focus}>{name}</Text>
          <Text color={THEME.hint}>
            <Text color={THEME.keyword}>Enter</Text> edit name · <Text color={THEME.keyword}>Del</Text> remove
          </Text>
        </>
      ) : (
        <>
          <Text>{'  '}</Text>
          <Text color={bulletColor ?? THEME.success}>•</Text>
          <Text>{name}</Text>
        </>
      )}
    </Box>
  )
}
