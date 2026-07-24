import { type EditOperation, previewEditOperations } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import { THEME } from '../../theme.ts'

export function EditSuccessView({ operations, buildArg }: { operations: EditOperation[]; buildArg: string }) {
  const lines = previewEditOperations(operations)

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={THEME.success} bold>
          Changes applied.
        </Text>
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line) => (
          <Text key={`${line.verb}:${line.path}`} color={THEME.hint}>
            {line.verb} {line.path}
          </Text>
        ))}
      </Box>
      <Text color={THEME.hint}>Run "facet build{buildArg}" to validate your facet.</Text>
    </Box>
  )
}
