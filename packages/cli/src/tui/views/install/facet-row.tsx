import type { FacetOutcome, FacetStage, RunInstallFailure } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { THEME } from '../../theme.ts'

/**
 * Per-facet display state for `<InstallView />`.
 *
 *   - `stage` is set while a stage event is in flight (no outcome or
 *     failure yet). Renders a spinner + the stage label.
 *   - `outcome` is set on success (`facet-success`). Renders a check
 *     mark + the bun-style summary line.
 *   - `failure` is set on rejection (`facet-failure`). Renders an X +
 *     a one-line failure summary; the full structured failure block
 *     appears once at the bottom of the view, not per-facet.
 */
export interface FacetState {
  name: string
  specifier: string
  stage: FacetStage | null
  outcome: FacetOutcome | null
  failure: RunInstallFailure | null
}

const STAGE_LABELS: Record<FacetStage, string> = {
  parse: 'parsing',
  resolve: 'resolving',
  fetch: 'fetching',
  verify: 'verifying',
  load: 'loading manifest',
  build: 'building',
  materialize: 'materializing',
}

export function FacetRow({ state }: { state: FacetState }) {
  if (state.outcome) {
    return <OutcomeRow name={state.name} outcome={state.outcome} />
  }
  if (state.failure) {
    return <FailureSummaryRow name={state.name} failure={state.failure} />
  }
  return <ProgressRow name={state.name} specifier={state.specifier} stage={state.stage} />
}

function ProgressRow({ name, specifier, stage }: { name: string; specifier: string; stage: FacetStage | null }) {
  const stageLabel = stage ? STAGE_LABELS[stage] : 'starting'
  return (
    <Box gap={1}>
      <Text color={THEME.secondary}>
        <Spinner type="dots" />
      </Text>
      <Text>
        {name} <Text color={THEME.hint}>@ {specifier}</Text>
      </Text>
      <Text color={THEME.hint}>— {stageLabel}</Text>
    </Box>
  )
}

function OutcomeRow({ name, outcome }: { name: string; outcome: FacetOutcome }) {
  switch (outcome.kind) {
    case 'installed':
      return (
        <Box gap={1}>
          <Text color={THEME.success}>+</Text>
          <Text>
            {name}@{outcome.version}
          </Text>
        </Box>
      )
    case 'updated':
      return (
        <Box gap={1}>
          <Text color={THEME.success}>+</Text>
          <Text>
            {name}@{outcome.newVersion}{' '}
            <Text color={THEME.hint}>
              (was {outcome.oldVersion} → {outcome.newVersion})
            </Text>
          </Text>
        </Box>
      )
    case 'repaired':
      return (
        <Box gap={1}>
          <Text color={THEME.warning}>↻</Text>
          <Text>
            {name}@{outcome.version} <Text color={THEME.hint}>(repaired)</Text>
          </Text>
        </Box>
      )
    case 'unchanged':
      return (
        <Box gap={1}>
          <Text color={THEME.hint}>=</Text>
          <Text dimColor>
            {name}@{outcome.version}
          </Text>
        </Box>
      )
    case 'removed':
      return (
        <Box gap={1}>
          <Text color={THEME.warning}>-</Text>
          <Text>
            {name}@{outcome.oldVersion}
          </Text>
        </Box>
      )
  }
}

function FailureSummaryRow({ name, failure }: { name: string; failure: RunInstallFailure }) {
  return (
    <Box gap={1}>
      <Text color={THEME.warning}>✕</Text>
      <Text>{name}</Text>
      <Text color={THEME.hint}>— {oneLineFailureSummary(failure)}</Text>
    </Box>
  )
}

/**
 * Single-line summary used inline alongside the failed facet row. The
 * full structured failure block is rendered once at the bottom of the
 * view by `<FailureBlock />`.
 */
function oneLineFailureSummary(failure: RunInstallFailure): string {
  switch (failure.code) {
    case 'PARSE_ERROR':
      return `parse error (${failure.error.code})`
    case 'REGISTRY_ERROR':
      return `registry: ${failure.error.code.toLowerCase().replace(/_/g, ' ')}`
    case 'INTEGRITY_FAILURE':
      return failure.failure.kind === 'facet'
        ? `integrity check ${failure.failure.check} failed`
        : `asset integrity failed: ${failure.failure.path}`
    case 'COMPOSITION_REJECTED':
      return 'facet composition is not supported'
    case 'GIT_CLONE_FAILED':
      return 'git clone failed'
    case 'LOCAL_RESOLVE_FAILED':
      return 'local path resolution failed'
    case 'BUILD_FAILED':
      return `build failed (${failure.errors.length} error${failure.errors.length === 1 ? '' : 's'})`
    case 'MANIFEST_NAME_MISMATCH':
      return `manifest name "${failure.manifestName}" does not match`
    case 'MANIFEST_LOAD_FAILED':
      return 'failed to load facet.json'
    case 'ADAPTER_INSTALL_FAILED':
      return `adapter ${failure.adapter} failed during materialization`
    default:
      return 'install failed'
  }
}
