import type { RemovePrepareFailure } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import type React from 'react'
import { THEME } from '../../theme.ts'
import { UnsupportedManifestVersionBlock } from './unsupported-version-block.tsx'

/**
 * Renders the structured failure detail for the `remove` flow's
 * pre-install (prepare) phase — manifest read and write failures.
 * These failures occur before the install pipeline runs, so they have
 * no `RunInstallFailure` shape; the `remove` orchestrator reports them
 * as `RemovePrepareFailure` and the view renders them here.
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
    case 'manifest-unsupported-version':
      return <UnsupportedManifestVersionBlock detail={failure} />
    default: {
      const _exhaustive: never = failure
      return _exhaustive
    }
  }
}
