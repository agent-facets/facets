import { Box, Text } from 'ink'
import type { Line, Segment } from '../../../commands/info/format.ts'
import { THEME } from '../../theme.ts'

export interface InfoViewProps {
  lines: Line[]
}

/** `facet info` on a terminal: the formatted summary with its styles. */
export function InfoView({ lines }: InfoViewProps) {
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and rendered once.
        <Text key={index}>{line.length === 0 ? ' ' : line.map(renderSegment)}</Text>
      ))}
    </Box>
  )
}

function renderSegment(segment: Segment, index: number) {
  switch (segment.style) {
    case 'title':
    case 'label':
      return (
        <Text key={index} bold>
          {segment.text}
        </Text>
      )
    case 'action-label':
      return (
        <Text key={index} bold color={THEME.caution}>
          {segment.text}
        </Text>
      )
    case 'dim':
      return (
        <Text key={index} dimColor>
          {segment.text}
        </Text>
      )
    case 'hint':
      return (
        <Text key={index} color={THEME.hint}>
          {segment.text}
        </Text>
      )
    default:
      return <Text key={index}>{segment.text}</Text>
  }
}
