import { Box, Text } from 'ink'
import { THEME } from '../../theme.ts'

export interface ListRow {
  name: string
  value: string
}

export interface ListViewProps {
  rows: ReadonlyArray<ListRow>
}

/**
 * Renders the installed facets list with brand coloring.
 * Name in brand purple, version dimmed. Columns aligned via padEnd.
 */
export function ListView({ rows }: ListViewProps) {
  const nameWidth = rows.reduce((max, r) => Math.max(max, r.name.length), 0)

  return (
    <Box flexDirection="column">
      {rows.map((r) => (
        <Text key={r.name}>
          <Text bold color={THEME.brand}>
            {r.name.padEnd(nameWidth)}
          </Text>
          {'  '}
          <Text color={THEME.hint}>{r.value}</Text>
        </Text>
      ))}
    </Box>
  )
}
