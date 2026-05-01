import type { RunInstallFailure } from '@agent-facets/core'
import { Box, Text } from 'ink'
import { THEME } from '../../theme.ts'

/**
 * Renders the structured failure detail at the bottom of the install
 * view. Each failure variant gets its own format so callers can see
 * exactly what went wrong without parsing message strings.
 */
export function FailureBlock({ failure }: { failure: RunInstallFailure }) {
  switch (failure.code) {
    case 'FACETS_JSON_NOT_FOUND':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ facets.json not found
          </Text>
          <Text color={THEME.hint}> {failure.path}</Text>
        </Box>
      )
    case 'FACETS_JSON_INVALID':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ facets.json is invalid
          </Text>
          <Text color={THEME.hint}> {failure.path}</Text>
          <Text> {failure.error}</Text>
        </Box>
      )
    case 'LOCKFILE_INVALID':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ facets.lock is invalid
          </Text>
          <Text color={THEME.hint}> {failure.path}</Text>
          <Text> {failure.error}</Text>
        </Box>
      )
    case 'LOCK_HELD':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ another install is already running
          </Text>
          <Text color={THEME.hint}> pid: {failure.heldByPid}</Text>
          <Text color={THEME.hint}> lock: {failure.path}</Text>
        </Box>
      )
    case 'PARSE_ERROR':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ could not parse source for {failure.facet}
          </Text>
          <Text> specifier: {failure.specifier}</Text>
          <Text> {failure.error.what}</Text>
          <Text color={THEME.hint}> fix: {failure.error.fix}</Text>
        </Box>
      )
    case 'REGISTRY_ERROR':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ registry error for {failure.facet}
          </Text>
          {failure.error.code === 'REGISTRY_NOT_AVAILABLE' ? (
            <>
              <Text> {failure.error.what}</Text>
              <Text color={THEME.hint}> fix: {failure.error.fix}</Text>
            </>
          ) : null}
          {failure.error.code === 'NOT_FOUND' ? (
            <Text>
              {' '}
              not found: {failure.error.name}@{failure.error.spec}
            </Text>
          ) : null}
          {failure.error.code === 'NETWORK_ERROR' ? <Text> network: {failure.error.cause}</Text> : null}
        </Box>
      )
    case 'INTEGRITY_FAILURE':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ integrity check failed
          </Text>
          <Text> facet: {failure.failure.facet}</Text>
          {failure.failure.kind === 'facet' ? (
            <Text> check: {failure.failure.check}</Text>
          ) : (
            <Text> asset: {failure.failure.path}</Text>
          )}
          <Text> expected: {failure.failure.expected}</Text>
          <Text> observed: {failure.failure.observed}</Text>
          <Text color={THEME.hint}> No assets were written. Project state is unchanged.</Text>
        </Box>
      )
    case 'COMPOSITION_REJECTED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ facet composition is not supported
          </Text>
          <Text> {failure.facet} declares dependencies on other facets</Text>
        </Box>
      )
    case 'GIT_CLONE_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git clone failed for {failure.facet}
          </Text>
          <Text> {failure.cause}</Text>
        </Box>
      )
    case 'LOCAL_RESOLVE_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ local source resolution failed for {failure.facet}
          </Text>
          <Text> {failure.cause}</Text>
        </Box>
      )
    case 'BUILD_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ build failed for {failure.facet}
          </Text>
          {failure.errors.map((err, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: error list is stable for the lifetime of this render
            <Text key={idx}> {err.message}</Text>
          ))}
        </Box>
      )
    case 'MANIFEST_LOAD_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ could not load facet.json for {failure.facet}
          </Text>
          {failure.errors.map((err, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: error list is stable for the lifetime of this render
            <Text key={idx}> {err.message}</Text>
          ))}
        </Box>
      )
    case 'MANIFEST_NAME_MISMATCH':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ manifest name mismatch for {failure.facet}
          </Text>
          <Text>
            {' '}
            facets.json key: {failure.facet}, facet.json name: {failure.manifestName}
          </Text>
        </Box>
      )
    case 'ADAPTER_INSTALL_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ adapter {failure.adapter} failed during install of {failure.facet}
          </Text>
          <Text> {failure.cause}</Text>
        </Box>
      )
    case 'ABORTED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ install aborted
          </Text>
          <Text color={THEME.hint}> Rolled back to pre-install state.</Text>
        </Box>
      )
  }
}
