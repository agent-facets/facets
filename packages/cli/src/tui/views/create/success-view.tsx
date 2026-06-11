import { Box, Text } from 'ink'
import { THEME } from '../../theme.ts'

export function CreateSuccessView({ name, files, buildArg }: { name: string; files: string[]; buildArg: string }) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={THEME.success} bold>
          {name} created.
        </Text>
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        {files.map((f) => (
          <Text key={f} color={THEME.hint}>
            {f}
          </Text>
        ))}
      </Box>
      <Text color={THEME.hint}>Run "facet build{buildArg}" to validate your facet.</Text>
    </Box>
  )
}
