import type { RemovePrepareFailure } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import type React from 'react'
import { THEME } from '../../theme.ts'

/**
 * Renders the structured failure detail for the `remove` flow's
 * pre-install (prepare) phase — manifest read and undeclared-facet
 * validation. These failures occur before the install pipeline runs, so
 * they have no `RunInstallFailure` shape; the `remove` orchestrator
 * reports them as `RemovePrepareFailure` and the view renders them here.
 *
 * The explicit return type + `assertNever` default arm makes any new
 * `RemovePrepareFailure` variant a compile-time error here, mirroring
 * {@link AddPrepareFailureBlock}.
 */
export function RemovePrepareFailureBlock({ failure }: { failure: RemovePrepareFailure }): React.JSX.Element {
  switch (failure.reason) {
    case 'manifest-read':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ could not read facets.json
          </Text>
          <Text> {failure.error}</Text>
        </Box>
      )
    case 'not-declared': {
      const count = failure.names.length
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ {count === 1 ? 'facet is not declared' : 'facets are not declared'} in facets.json
          </Text>
          <Text> {failure.names.join(', ')}</Text>
          <Text color={THEME.hint}> nothing was removed; check the name(s) against facets.json</Text>
        </Box>
      )
    }
    case 'manifest-write':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ could not write facets.json
          </Text>
          <Text> {failure.error}</Text>
          <Text color={THEME.hint}> nothing was removed; check file permissions and disk space</Text>
        </Box>
      )
    default: {
      // Exhaustiveness guard: any new `RemovePrepareFailure` variant must
      // get a `case` arm above.
      const _exhaustive: never = failure
      return _exhaustive
    }
  }
}
