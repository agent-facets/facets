import type { McpServerCapabilityFailure } from '@agent-facets/adapter'
import type {
  LockfileDriftEntry,
  RollbackOutcome,
  RunInstallFailure,
  RunInstallResult,
  TransactionSubject,
} from '@agent-facets/engine'
import { describeTransactionFailure } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import type React from 'react'
import { describeCompatibilityFailure } from '../../../util/adapter-install-errors.ts'
import {
  aliasProblemLocation,
  collisionClaimants,
  collisionGroupKey,
  describeAlias,
  describeCollisionGroup,
} from '../../../util/collision-report.ts'
import { contributionKey, describeContribution } from '../../../util/contribution.ts'
import { describeRollbackIssue, diskStateSentence } from '../../../util/install-outcome.ts'
import {
  describeApprovalHeading,
  describeDeclarationInFull,
  describeMcpCapabilityFailure,
  describeMcpCapabilityHint,
  describeMcpContractViolation,
  describeMcpDocumentOverlap,
  describeTakeoverHeading,
  describeUnsupportedMcpAdapter,
} from '../../../util/mcp-report.ts'
import { THEME } from '../../theme.ts'
import { UnsupportedManifestVersionBlock } from './unsupported-version-block.tsx'

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
      return `${entry.name}:${entry.reason}:${entry.assetType}:${entry.authoredName}`
    case 'stale-override':
      return `${entry.name}:${entry.reason}:${contributionKey(entry.contribution)}:${entry.authoredName}`
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
/** The user-facing name of a project file a stale update plan was built from. */
function describeStaleFile(file: 'manifest' | 'lockfile'): string {
  return file === 'manifest' ? 'facets.json' : 'facets.lock'
}

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
      // Says explicitly that the override survived. Frozen mode reports
      // stale intent instead of pruning it, and a line that only named the
      // mismatch read as though it had already been cleaned up.
      return `${describeContribution(entry.contribution)} "${entry.authoredName}" has a materialization override but is not in the locked content (the override was NOT removed)`
    case 'materialization-unrepresentable':
      return `lockfile v${entry.lockfileVersion} cannot record materialization overrides (needs v${entry.requiredVersion})`
  }
}

/**
 * Renders a failed install: what went wrong, then what it left on disk.
 *
 * Takes the whole failed result rather than the failure alone, because the
 * two halves are only meaningful together. Splitting them let this block
 * assert "Rolled back to pre-install state" under an abort that happened
 * before anything was written — the rollback outcome is the only thing that
 * knows, and it lived on the value the block was not given. A separate
 * optional `rollback` prop would have kept that state representable; the
 * failed result always carries both.
 */
export function FailureBlock({ result }: { result: Extract<RunInstallResult, { ok: false }> }): React.JSX.Element {
  return (
    <>
      {failureDetail(result.failure)}
      <RollbackNote rollback={result.rollback} />
    </>
  )
}

/**
 * What the run left on disk. Rendered once, for every failure code, from the
 * same helper the stderr `fix:` line uses — so the two surfaces cannot
 * disagree, and no failure arm has to remember to say it.
 */
function RollbackNote({ rollback }: { rollback: RollbackOutcome }): React.JSX.Element {
  if (rollback.kind === 'incomplete') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={THEME.warning}>⚠ {diskStateSentence(rollback)}</Text>
        {rollback.issues.map((issue) => (
          <Text key={issue.path} color={THEME.hint}>
            {'  '}
            {describeRollbackIssue(issue)}
          </Text>
        ))}
      </Box>
    )
  }
  return <Text color={THEME.hint}> {diskStateSentence(rollback)}</Text>
}

/**
 * Why an adapter's MCP failure matters, when the line above it does not say.
 *
 * A component rather than an inline conditional because both MCP capability
 * arms need it and neither should have to remember whether this particular
 * failure has a hint at all.
 */
function McpCapabilityHint({ failure }: { failure: McpServerCapabilityFailure }): React.JSX.Element | null {
  const hint = describeMcpCapabilityHint(failure)
  if (hint === undefined) return null
  return <Text color={THEME.hint}> {hint}</Text>
}

/**
 * The structured detail for one failure variant. Each gets its own format so
 * callers can see exactly what went wrong without parsing message strings.
 *
 * No arm states what is on disk — {@link RollbackNote} owns that.
 *
 * The explicit return type + `assertNever` default arm makes any new
 * `RunInstallFailure` variant a type error here at compile time, so we
 * can't ship a failure code with no rendering (which previously left
 * users staring at a blank failure block).
 */
function failureDetail(failure: RunInstallFailure): React.JSX.Element {
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
      return <UnsupportedManifestVersionBlock detail={failure} />
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
          <Text color={THEME.hint}> Fix the underlying I/O issue and retry.</Text>
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
          <Text> private repositories require git authentication</Text>
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
    case 'FILESYSTEM_TRANSACTION_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ {describeTransactionSubject(failure.subject)} could not be written
          </Text>
          <Text> {describeTransactionFailure(failure.batch.failure)}</Text>
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
    case 'UPDATE_PLAN_STALE':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ the project changed while this update was being reviewed
          </Text>
          <Text> {failure.files.map(describeStaleFile).join(' and ')} no longer matches the reviewed plan</Text>
          <Text color={THEME.hint}> Nothing was applied. Run `facet update` again to see current versions.</Text>
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
          {failure.groups.map((entry) => (
            <Box key={collisionGroupKey(entry)} flexDirection="column">
              <Text>
                {' '}
                {describeCollisionGroup(entry)} — “{entry.group.effectiveName}” is claimed by:
              </Text>
              {collisionClaimants(entry).map((claimant) => (
                <Box key={claimant.key} flexDirection="column">
                  <Text color={THEME.hint}>
                    {'   '}
                    {claimant.facet} ({claimant.label}) → “{claimant.effectiveName}”{describeAlias(claimant)}
                  </Text>
                  {/* A server's declaration summary, so two claimants sharing
                      a name are still told apart. Empty for an asset. */}
                  {claimant.detail.map((detail) => (
                    <Text key={detail} color={THEME.hint}>
                      {'     '}
                      {detail}
                    </Text>
                  ))}
                  {/* The exact edit site, derived from the published
                      group mapping so it cannot drift from the schema. */}
                  <Text color={THEME.hint}>
                    {'     '}
                    {claimant.location}
                  </Text>
                </Box>
              ))}
            </Box>
          ))}
          <Text color={THEME.hint}> Record an alias or omission per claimant in facets.json, then re-run.</Text>
        </Box>
      )
    case 'MATERIALIZATION_ALIAS_INVALID':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ invalid materialization alias
          </Text>
          {failure.problems.map((problem) => (
            <Text key={aliasProblemLocation(problem)} color={THEME.hint}>
              {' '}
              “{problem.alias}” {problem.reason} — at {aliasProblemLocation(problem)}
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
            <Text key={aliasProblemLocation(problem)} color={THEME.hint}>
              {' '}
              “{problem.alias}” {problem.reason} — at {aliasProblemLocation(problem)}
            </Text>
          ))}
          {failure.groups.map((entry) => (
            <Text key={collisionGroupKey(entry)} color={THEME.hint}>
              {' '}
              {/* Humanized, like the collision arm above: the raw
                  discriminant (`skill-command`) is an internal name, and it
                  drops the scope entirely. */}
              {describeCollisionGroup(entry)} “{entry.group.effectiveName}” is still claimed by{' '}
              {collisionClaimants(entry)
                .map((claimant) => claimant.facet)
                .join(', ')}
            </Text>
          ))}
        </Box>
      )
    case 'MATERIALIZATION_CANCELLED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.hint}>Cancelled.</Text>
        </Box>
      )
    case 'MCP_ADAPTERS_UNSUPPORTED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ {failure.adapters.length !== 1 ? 'selected adapters cannot' : 'a selected adapter cannot'} configure MCP
            servers
          </Text>
          {failure.adapters.map((entry) => {
            const described = describeUnsupportedMcpAdapter(entry)
            return (
              <Box key={entry.adapter} flexDirection="column">
                <Text> {described.what}</Text>
                <Text color={THEME.hint}> {described.fix}</Text>
              </Box>
            )
          })}
          <Text color={THEME.hint}> servers: {failure.servers.join(', ')}</Text>
        </Box>
      )
    case 'MCP_PREPARE_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ {failure.adapter} could not plan its MCP configuration
          </Text>
          <Text> {describeMcpCapabilityFailure(failure.failure)}</Text>
          <McpCapabilityHint failure={failure.failure} />
        </Box>
      )
    case 'ASSET_TAKEOVER_CANCELLED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.hint}>
            Cancelled at {failure.adapter}: {failure.asset.scope} {failure.asset.type} “{failure.asset.name}” (wanted by{' '}
            {failure.facet}) was already there and is not tracked by this project.
          </Text>
        </Box>
      )
    case 'MCP_APPLY_FAILED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ {failure.adapter} could not write its MCP configuration
          </Text>
          <Text> {describeMcpCapabilityFailure(failure.failure)}</Text>
          <McpCapabilityHint failure={failure.failure} />
        </Box>
      )
    case 'MCP_CONSENT_REQUIRED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ MCP server configuration needs your approval
          </Text>
          {failure.request.declarations.map((entry) => (
            <Box key={entry.identity.effectiveName} flexDirection="column">
              <Text> {describeApprovalHeading(entry)}</Text>
              {describeDeclarationInFull(entry.declaration).map((line) => (
                <Text key={line} color={THEME.hint}>
                  {'   '}
                  {line}
                </Text>
              ))}
            </Box>
          ))}
          {failure.request.takeovers.map((entry) => (
            <Text key={`${entry.adapter}:${entry.identity.effectiveName}`}> {describeTakeoverHeading(entry)}</Text>
          ))}
        </Box>
      )
    case 'MCP_CONSENT_DECLINED':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.hint}>Declined. No MCP server configuration was written.</Text>
        </Box>
      )
    case 'MCP_CONTRACT_VIOLATION':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ an adapter broke the MCP configuration contract
          </Text>
          <Text> {describeMcpContractViolation(failure.violation)}</Text>
          <Text color={THEME.hint}> this is an adapter bug; report it to the adapter's author</Text>
        </Box>
      )
    case 'MCP_DOCUMENT_OVERLAP':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ two selected adapters configure the same file
          </Text>
          {failure.overlaps.map((overlap) => (
            <Text key={overlap.claimants.map((claimant) => claimant.adapter).join('+')}>
              {' '}
              {describeMcpDocumentOverlap(overlap)}
            </Text>
          ))}
          <Text color={THEME.hint}> configuring one MCP file from two adapters is not supported</Text>
        </Box>
      )
    case 'MCP_NATIVE_STATE_DRIFT':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ {failure.adapter}'s MCP configuration changed while this run was working
          </Text>
          {failure.documents.map((path) => (
            <Text key={path} color={THEME.hint}>
              {'  '}
              {path}
            </Text>
          ))}
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

/** What a failed batch of file changes was for, in one phrase. */
function describeTransactionSubject(subject: TransactionSubject): string {
  switch (subject.kind) {
    case 'asset':
      return `${subject.asset.scope} ${subject.asset.type} “${subject.asset.name}” for ${subject.facet} (${subject.adapter})`
    case 'mcp':
      return `${subject.adapter}'s MCP configuration`
    case 'project-files':
      return "the project's manifest, lockfile, and install receipt"
  }
}
