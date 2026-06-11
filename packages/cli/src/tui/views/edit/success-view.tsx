import type { EditOperation } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import { THEME } from '../../theme.ts'

export function EditSuccessView({ operations, buildArg }: { operations: EditOperation[]; buildArg: string }) {
  const scaffolded = operations.filter((op) => op.op === 'scaffold').length
  const deleted = operations.filter((op) => op.op === 'delete-file').length
  const parts: string[] = []
  if (scaffolded > 0) parts.push(`${scaffolded} scaffolded`)
  if (deleted > 0) parts.push(`${deleted} removed`)
  parts.push('manifest updated')

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={THEME.success} bold>
          Changes applied.
        </Text>
      </Text>
      <Box marginLeft={2}>
        <Text color={THEME.hint}>{parts.join(' · ')}</Text>
      </Box>
      <Text color={THEME.hint}>Run "facet build{buildArg}" to validate your facet.</Text>
    </Box>
  )
}
