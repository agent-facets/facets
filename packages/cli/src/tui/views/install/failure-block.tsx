import type { RunInstallFailure } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import type React from 'react'
import { THEME } from '../../theme.ts'

/**
 * Renders the structured failure detail at the bottom of the install
 * view. Each failure variant gets its own format so callers can see
 * exactly what went wrong without parsing message strings.
 *
 * The explicit return type + `assertNever` default arm makes any new
 * `RunInstallFailure` variant a type error here at compile time, so we
 * can't ship a failure code with no rendering (which previously left
 * users staring at a blank failure block).
 */
export function FailureBlock({ failure }: { failure: RunInstallFailure }): React.JSX.Element {
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
    case 'LOCKFILE_WRITE_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ could not write facets.lock
          </Text>
          <Text color={THEME.hint}> {failure.path}</Text>
          <Text> {failure.cause}</Text>
          <Text color={THEME.hint}> Assets were rolled back. Fix the underlying I/O issue and retry.</Text>
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
          {failure.error.code === 'REGISTRY_REJECTED' ? (
            <>
              <Text> {failure.error.error}</Text>
              <Text color={THEME.hint}> fix: {failure.error.fix}</Text>
            </>
          ) : null}
          {failure.error.code === 'UNPARSEABLE_RESPONSE' ? (
            <Text> registry returned an unreadable response (HTTP {failure.error.status})</Text>
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
    case 'CACHE_INTEGRITY_MISMATCH':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ cache integrity mismatch for {failure.facet}
          </Text>
          <Text color={THEME.hint}> slot: {failure.slotPath}</Text>
          <Text> cached: {failure.cachedIntegrity}</Text>
          <Text> locked: {failure.lockedIntegrity}</Text>
          <Text color={THEME.hint}> Fix: rm -rf "{failure.slotPath}" and re-run install</Text>
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
    case 'GIT_BINARY_MISSING':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git is not installed (or not on PATH)
          </Text>
          <Text> install git and re-run this command</Text>
        </Box>
      )
    case 'GIT_AUTH_REQUIRED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git authentication required for {failure.url}
          </Text>
          <Text> closed alpha supports public repos and SSH (via agent) only</Text>
        </Box>
      )
    case 'GIT_CLONE_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git clone failed for {failure.facet} ({failure.url})
          </Text>
          <Text> {failure.stderr}</Text>
        </Box>
      )
    case 'GIT_CHECKOUT_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ git checkout {failure.commitish} failed for {failure.facet} ({failure.url})
          </Text>
          <Text> {failure.stderr}</Text>
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
    case 'ADAPTER_UNSUPPORTED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ adapter {failure.adapter} does not support install
          </Text>
          <Text> update this adapter or remove it with `facet adapter remove {failure.adapter}`</Text>
        </Box>
      )
    case 'ADAPTER_READ_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ adapter {failure.adapter} could not read {failure.asset.type}:{failure.asset.name} for {failure.facet}
          </Text>
          <Text> {failure.cause}</Text>
        </Box>
      )
    case 'ADAPTER_INSTALL_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ adapter {failure.adapter} failed installing {failure.asset.type}:{failure.asset.name} for {failure.facet}
          </Text>
          <Text> {failure.cause}</Text>
        </Box>
      )
    case 'ADAPTER_DELETE_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ adapter {failure.adapter} failed deleting {failure.asset.type}:{failure.asset.name} for {failure.facet}
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
    case 'LOCKFILE_DRIFT':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ lockfile is out of date with facets.json
          </Text>
          {failure.facets.map((f) => (
            <Text key={f.name}>
              {' '}
              {f.name}:{' '}
              {f.reason === 'missing-lockfile'
                ? 'no lockfile'
                : f.reason === 'no-entry'
                  ? `not in lockfile (manifest wants ${f.manifestSpec})`
                  : f.reason === 'orphaned'
                    ? `in lockfile but not in facets.json (locked ${f.lockedVersion})`
                    : f.reason === 'source-changed'
                      ? `source changed: locked ${f.lockedSource}, manifest wants ${f.manifestSpec}`
                      : `locked ${f.lockedVersion} does not satisfy ${f.manifestSpec}`}
            </Text>
          ))}
          <Text color={THEME.hint}> Run without --frozen-lockfile, or `facet add` to update the lockfile.</Text>
        </Box>
      )
    default: {
      // Exhaustiveness guard: any new `RunInstallFailure` variant must
      // get a `case` arm above. Without this, an un-rendered failure
      // code silently produced a blank failure block.
      const _exhaustive: never = failure
      return _exhaustive
    }
  }
}
