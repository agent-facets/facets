import { Box, Text } from 'ink'
import { ProgressBar } from '../../components/progress-bar.tsx'
import { THEME } from '../../theme.ts'

/**
 * What the terminal shows while update discovery is in flight.
 *
 * Discovery asks the registry for two versions per registry facet, which
 * on a real project is the slowest thing `facet update` does and the
 * only part of it that produces no output. Without this, a user who
 * types the command sees an empty screen for several seconds and cannot
 * tell a working command from a hung one.
 *
 * The indicator is deliberately indeterminate. Discovery resolves its
 * lookups in concurrent groups and reports nothing until the whole set
 * settles, so any "3 of 12" or percentage rendered here would be a
 * number this view invented rather than one the work reported.
 */
export function UpdateDiscoveryView() {
  return (
    <Box flexDirection="column">
      <Text color={THEME.hint}>Checking the registry for facet updates</Text>
      <ProgressBar done={false} width={12} />
    </Box>
  )
}
