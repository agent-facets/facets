import type { LockfileDriftEntry, RunInstallFailure } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import type React from 'react'
import { describeCompatibilityFailure } from '../../../util/adapter-install-errors.ts'
import { describeNamespace, manifestLocation } from '../../../util/collision-report.ts'
import { THEME } from '../../theme.ts'

/** How a materialization disposition reads in a one-line drift report. */
function describeDisposition(disposition: { kind: string; as?: string }): string {
  return disposition.kind === 'aliased' ? `aliased to "${disposition.as}"` : disposition.kind
}

/**
 * A stable React key for one drift entry.
 *
 * Facet + reason is not unique on its own: a facet can drift on several assets
 * at once. The two per-asset reasons therefore include the asset; every other
 * reason is at most one per facet by construction.
 */
function driftKey(entry: LockfileDriftEntry): string {
  switch (entry.reason) {
    case 'materialization-drift':
    case 'stale-override':
      return `${entry.name}:${entry.reason}:${entry.assetType}:${entry.authoredName}`
    default:
      return `${entry.name}:${entry.reason}`
  }
}

/**
 * One line of frozen-lockfile drift detail.
 *
 * An exhaustive `switch`, deliberately: this was a chain of ternaries whose
 * final `else` assumed `unsatisfied` and read fields off it. Every reason
 * added afterwards would have rendered another reason's text with `undefined`
 * spliced into it, and nothing would have failed.
 */
function describeDrift(entry: LockfileDriftEntry): string {
  switch (entry.reason) {
    case 'missing-lockfile':
      return 'no lockfile'
    case 'no-entry':
      return `not in lockfile (manifest wants ${entry.manifestSpec})`
    case 'orphaned':
      return `in lockfile but not in facets.json (locked ${entry.lockedVersion})`
    case 'source-changed':
      return `source changed: locked ${entry.lockedSource}, manifest wants ${entry.manifestSpec}`
    case 'unsatisfied':
      return `locked ${entry.lockedVersion} does not satisfy ${entry.manifestSpec}`
    case 'materialization-drift':
      return `${entry.assetType} "${entry.authoredName}": facets.json says ${describeDisposition(entry.manifest)}, lockfile says ${describeDisposition(entry.locked)}`
    case 'stale-override':
      return `${entry.assetType} "${entry.authoredName}" has a materialization override but is not in the locked content`
    case 'materialization-unrepresentable':
      return `lockfile v${entry.lockfileVersion} cannot record materialization overrides (needs v${entry.requiredVersion})`
  }
}

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
    case 'FACETS_JSON_UNSUPPORTED_VERSION':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ facets.json declares an unsupported manifestVersion
          </Text>
          <Text color={THEME.hint}> {failure.path}</Text>
          <Text>
            {' '}
            found {failure.observed ?? 'a non-numeric value'}; this CLI supports {failure.supported.join(', ')} and
            unversioned manifests
          </Text>
          <Text color={THEME.hint}> Upgrade the CLI to a version that understands this manifest.</Text>
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
          {failure.error.code === 'UNSUPPORTED_ARCHIVE' ? (
            <Text>
              {' '}
              archive format {failure.error.observed ?? '(unknown)'} is not supported by this CLI — update agent-facets
            </Text>
          ) : null}
        </Box>
      )
    case 'CONFIRMATION_UNAVAILABLE':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ cannot create a lockfile entry for {failure.facet}@{failure.version} without registry confirmation
          </Text>
          <Text>
            {' '}
            The content is already cached — nothing needed downloading — but a new lockfile entry requires the
            registry's published integrity, and the registry could not be reached.
          </Text>
          {failure.error.code === 'NETWORK_ERROR' ? <Text> network: {failure.error.cause}</Text> : null}
          <Text color={THEME.hint}> Reconnect and retry. Reproducing an existing lockfile entry works offline.</Text>
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
    case 'GIT_COMMIT_UNRESOLVED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ could not resolve a commit for {failure.facet} ({failure.url})
          </Text>
          <Text> a git source must resolve to a commit to be reproducible</Text>
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
    case 'ADAPTER_INCOMPATIBLE':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ incompatible adapter{failure.failures.length !== 1 ? 's' : ''} selected — nothing was installed
          </Text>
          {failure.failures.map((compat) => {
            const described = describeCompatibilityFailure(compat)
            return (
              <Box key={compat.adapter} flexDirection="column">
                <Text> {described.what}</Text>
                <Text color={THEME.hint}>
                  {' '}
                  {described.detail} — {described.fix}
                </Text>
              </Box>
            )
          })}
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
            <Text key={driftKey(f)}>
              {' '}
              {f.name}: {describeDrift(f)}
            </Text>
          ))}
          <Text color={THEME.hint}> Run without --frozen-lockfile, or `facet add` to update the lockfile.</Text>
        </Box>
      )
    case 'FROZEN_WITH_DELTA':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ cannot add or remove with --frozen-lockfile
          </Text>
          <Text color={THEME.hint}> Run without --frozen-lockfile to modify the locked set.</Text>
        </Box>
      )
    case 'DELTA_CONFLICT':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ internal error: delta conflict
          </Text>
          <Text> facet "{failure.facet}" appears in both additions and removals</Text>
          <Text color={THEME.hint}>
            {' '}
            This is a bug — please file an issue @{' '}
            <Text color={THEME.brand} bold>
              https://github.com/agent-facets/facets/issues/new
            </Text>
          </Text>
        </Box>
      )
    case 'RECONCILE_FACET_INTEGRITY':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ lockfile integrity mismatch for {failure.facet}
          </Text>
          <Text color={THEME.hint}> expected {failure.expected}</Text>
          <Text color={THEME.hint}> actual {failure.actual}</Text>
          <Text color={THEME.hint}>
            {' '}
            The lockfile disagrees with the resolved content. Delete facets.lock and re-run.
          </Text>
        </Box>
      )
    case 'RECONCILE_ASSET_IDENTITY':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ lockfile asset set does not match resolved content for {failure.facet}
          </Text>
          {failure.missing.length > 0 && (
            <Text color={THEME.hint}> locked but not resolved: {failure.missing.join(', ')}</Text>
          )}
          {failure.unexpected.length > 0 && (
            <Text color={THEME.hint}> resolved but not locked: {failure.unexpected.join(', ')}</Text>
          )}
          <Text color={THEME.hint}> Delete facets.lock and re-run, or `facet add` to update it.</Text>
        </Box>
      )
    case 'RECONCILE_OWNED_PATH_SET':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ lockfile file set does not match resolved content for {failure.facet} ({failure.asset})
          </Text>
          {failure.missing.length > 0 && (
            <Text color={THEME.hint}> locked but not resolved: {failure.missing.join(', ')}</Text>
          )}
          {failure.unexpected.length > 0 && (
            <Text color={THEME.hint}> resolved but not locked: {failure.unexpected.join(', ')}</Text>
          )}
          <Text color={THEME.hint}> Delete facets.lock and re-run, or `facet add` to update it.</Text>
        </Box>
      )
    case 'RECONCILE_PER_FILE_INTEGRITY':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ file integrity mismatch: {failure.path}
          </Text>
          <Text color={THEME.hint}>
            {' '}
            in {failure.facet} ({failure.asset})
          </Text>
          <Text color={THEME.hint}> expected {failure.expected}</Text>
          <Text color={THEME.hint}> actual {failure.actual}</Text>
          <Text color={THEME.hint}> Delete facets.lock and re-run, or `facet add` to update it.</Text>
        </Box>
      )
    case 'MATERIALIZATION_COLLISION':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ two or more facets want the same name
          </Text>
          {failure.groups.map((group) => (
            <Box key={`${group.scope}:${group.namespace}:${group.effectiveName}`} flexDirection="column">
              <Text>
                {' '}
                {describeNamespace(group.namespace, group.scope)} — “{group.effectiveName}” is claimed by:
              </Text>
              {group.members.map((member) => (
                <Box key={`${member.facet}:${member.type}:${member.authoredName}`} flexDirection="column">
                  <Text color={THEME.hint}>
                    {'   '}
                    {member.facet} ({member.type} {member.authoredName})
                  </Text>
                  {/* The exact edit site, derived from the published
                      group mapping so it cannot drift from the schema. */}
                  <Text color={THEME.hint}>
                    {'     '}
                    {manifestLocation(member.facet, member.type, member.authoredName)}
                  </Text>
                </Box>
              ))}
            </Box>
          ))}
          <Text color={THEME.hint}>
            {' '}
            Nothing was changed. Record an alias or omission per asset in facets.json, then re-run.
          </Text>
        </Box>
      )
    case 'MATERIALIZATION_ALIAS_INVALID':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ invalid materialization alias
          </Text>
          {failure.problems.map((problem) => (
            <Text key={`${problem.facet}:${problem.alias}`} color={THEME.hint}>
              {' '}
              {problem.facet}: “{problem.alias}” {problem.reason}
            </Text>
          ))}
        </Box>
      )
    case 'MATERIALIZATION_RESOLUTION_INVALID':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ the chosen names still conflict
          </Text>
          {failure.problems.map((problem) => (
            <Text key={`${problem.facet}:${problem.alias}`} color={THEME.hint}>
              {' '}
              {problem.facet}: “{problem.alias}” {problem.reason}
            </Text>
          ))}
          {failure.groups.map((group) => (
            <Text key={`${group.scope}:${group.namespace}:${group.effectiveName}`} color={THEME.hint}>
              {' '}
              {group.namespace} “{group.effectiveName}” is still claimed by{' '}
              {group.members.map((m) => m.facet).join(', ')}
            </Text>
          ))}
          <Text color={THEME.hint}> Nothing was changed.</Text>
        </Box>
      )
    case 'MATERIALIZATION_CANCELLED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.hint}>Cancelled. Nothing was changed.</Text>
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
