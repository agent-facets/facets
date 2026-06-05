import type { AddPrepareFailure } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import type React from 'react'
import { THEME } from '../../theme.ts'

/**
 * Renders the structured failure detail for the `add` flow's pre-install
 * (prepare) phase — name resolution and manifest read. These failures
 * occur before the install pipeline runs, so they have no
 * `RunInstallFailure` shape; the `add` orchestrator reports them as
 * `AddPrepareFailure` and the view renders them here.
 *
 * The explicit return type + `assertNever` default arm makes any new
 * `AddPrepareFailure` variant a compile-time error here, mirroring
 * {@link FailureBlock}.
 */
export function AddPrepareFailureBlock({ failure }: { failure: AddPrepareFailure }): React.JSX.Element {
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
    case 'git-binary-missing':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git is not installed (or not on PATH)
          </Text>
          <Text> source: {failure.specifier}</Text>
          <Text color={THEME.hint}> install git and re-run this command</Text>
        </Box>
      )
    case 'git-auth-required':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git authentication required for {failure.url}
          </Text>
          <Text> source: {failure.specifier}</Text>
          <Text color={THEME.hint}> closed alpha supports public repos and SSH (via agent) only</Text>
        </Box>
      )
    case 'git-clone-failed':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git clone failed for {failure.specifier}
          </Text>
          <Text> {failure.stderr}</Text>
        </Box>
      )
    case 'git-checkout-failed':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git checkout {failure.commitish} failed for {failure.specifier}
          </Text>
          <Text> {failure.stderr}</Text>
        </Box>
      )
    case 'local-resolve-failed':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ could not resolve local source {failure.specifier}
          </Text>
          <Text> {failure.error}</Text>
        </Box>
      )
    case 'manifest-load-failed':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ could not load facet.json from {failure.specifier}
          </Text>
          <Text> {failure.detail}</Text>
        </Box>
      )
    case 'composition-rejected':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ facet composition is not supported
          </Text>
          <Text> {failure.specifier} declares dependencies on other facets</Text>
        </Box>
      )
    default: {
      // Exhaustiveness guard: any new `AddPrepareFailure` variant must get
      // a `case` arm above.
      const _exhaustive: never = failure
      return _exhaustive
    }
  }
}
