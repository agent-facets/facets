import { Box, Text } from 'ink'

export function truncateDescription(text: string, maxLen = 50): string {
  const lines = text.split(/\r?\n/)
  const firstLine = lines[0] ?? text
  const hasMore = lines.length > 1
  if (firstLine.length <= maxLen) return hasMore ? `${firstLine}...` : firstLine
  return `${firstLine.slice(0, maxLen)}...`
}

export function AssetDescription({ description }: { description: string }) {
  return (
    <Box marginLeft={4}>
      <Text dimColor>{truncateDescription(description)}</Text>
    </Box>
  )
}
