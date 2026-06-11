import type { AddPrepareFailure, RemovePrepareFailure, RunInstallResult, StageEvent } from '@agent-facets/engine'
import { Box, Text, useApp, useStderr } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ProgressBar } from '../../components/progress-bar.tsx'
import { ASSET_TYPE_COLORS, THEME } from '../../theme.ts'
import { AddPrepareFailureBlock } from './add-prepare-failure-block.tsx'
import { type FacetState, STAGE_LABELS } from './facet-row.tsx'
import { FailureBlock } from './failure-block.tsx'
import { RemovePrepareFailureBlock } from './remove-prepare-failure-block.tsx'

/**
 * Driver result. The `install` flow returns a `RunInstallResult`. The
 * `add` and `remove` flows may instead fail in a pre-install (prepare)
 * phase — `add`: name resolution / manifest read; `remove`: manifest read
 * / undeclared facet — which has no `RunInstallResult` shape, so it
 * surfaces as a distinct `prepare-failure` arm. The arm is tagged by which
 * flow produced it so the view renders the matching block.
 */
export type InstallViewResult =
  | RunInstallResult
  | { ok: false; prepareFailure: AddPrepareFailure }
  | { ok: false; removePrepareFailure: RemovePrepareFailure }

export interface InstallViewProps {
  /**
   * Driver: caller supplies `runInstall`-equivalent closure that takes
   * an `onStage` callback and an optional `onLog` callback, and returns
   * the result. The view runs it once on mount and surfaces its events /
   * outcome. When verbose output is enabled, the caller should thread
   * `onLog` into the engine call; the view routes it through Ink's
   * stderr writer so it doesn't race the progress bar repaint.
   */
  run: (onStage: (event: StageEvent) => void, onLog?: (line: string) => void) => Promise<InstallViewResult>
  /**
   * Header copy hint. `'add'` renders "Adding facets..."; `'install'`
   * renders "Installing facets..."; `'remove'` renders "Removing
   * facets...". Functional behavior is identical.
   */
  mode: 'add' | 'install' | 'remove'
  /**
   * Fires once when the install completes, before Ink unmounts. Lets
   * the caller capture the result for exit-code mapping.
   */
  onComplete?: (result: InstallViewResult) => void
}

/** Type guard: a driver result that is an add prepare-phase failure. */
function isPrepareFailure(r: InstallViewResult): r is { ok: false; prepareFailure: AddPrepareFailure } {
  return !r.ok && 'prepareFailure' in r
}

/** Type guard: a driver result that is a remove prepare-phase failure. */
function isRemovePrepareFailure(r: InstallViewResult): r is { ok: false; removePrepareFailure: RemovePrepareFailure } {
  return !r.ok && 'removePrepareFailure' in r
}

/**
 * Type guard: a driver result that is an install-pipeline failure (a
 * `RunInstallResult` with `ok: false`), as opposed to a prepare-phase
 * failure. Narrows so `.failure` and `.rollback` are accessible.
 */
function isInstallFailure(r: InstallViewResult): r is Extract<RunInstallResult, { ok: false }> {
  return !r.ok && !isPrepareFailure(r) && !isRemovePrepareFailure(r)
}

interface ServerWarning {
  facet: string
  servers: ReadonlyArray<string>
}

interface DriftRemoval {
  facet: string
  oldVersion: string
}

export function InstallView({ run, mode, onComplete }: InstallViewProps) {
  const { exit } = useApp()
  const { write: writeToStderr } = useStderr()
  const [totalFacets, setTotalFacets] = useState(0)
  const [facetOrder, setFacetOrder] = useState<string[]>([])
  const [facets, setFacets] = useState<Record<string, FacetState>>({})
  const [serverWarnings, setServerWarnings] = useState<ServerWarning[]>([])
  const [_driftRemovals, setDriftRemovals] = useState<DriftRemoval[]>([])
  /** Per-facet adapter completions: facetName → list of adapter names done. */
  const [adaptersByFacet, setAdaptersByFacet] = useState<Record<string, string[]>>({})
  const [result, setResult] = useState<InstallViewResult | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [exitState, setExitState] = useState<
    { kind: 'idle' } | { kind: 'success' } | { kind: 'failure'; error: Error }
  >({ kind: 'idle' })
  const startedRef = useRef(false)
  const startTimeRef = useRef(Date.now())

  const onStage = useCallback((event: StageEvent) => {
    switch (event.kind) {
      case 'install-start':
        setTotalFacets(event.totalFacets)
        return
      case 'facet-start':
        setFacetOrder((prev) => (prev.includes(event.facet) ? prev : [...prev, event.facet]))
        setFacets((prev) => ({
          ...prev,
          [event.facet]: {
            name: event.facet,
            specifier: event.specifier,
            stage: null,
            outcome: null,
            failure: null,
          },
        }))
        return
      case 'facet-stage':
        setFacets((prev) => {
          const existing = prev[event.facet]
          if (!existing) return prev
          return { ...prev, [event.facet]: { ...existing, stage: event.stage } }
        })
        return
      case 'facet-success':
        setFacets((prev) => {
          const existing = prev[event.facet]
          if (!existing) return prev
          return {
            ...prev,
            [event.facet]: { ...existing, outcome: event.outcome, stage: null },
          }
        })
        return
      case 'facet-failure':
        setFacets((prev) => {
          const existing = prev[event.facet] ?? {
            name: event.facet,
            specifier: '',
            stage: null,
            outcome: null,
            failure: null,
          }
          return {
            ...prev,
            [event.facet]: { ...existing, failure: event.failure, stage: null },
          }
        })
        setFacetOrder((prev) => (prev.includes(event.facet) ? prev : [...prev, event.facet]))
        return
      case 'server-warning':
        setServerWarnings((prev) => [...prev, { facet: event.facet, servers: event.servers }])
        return
      case 'drift-removal':
        setDriftRemovals((prev) => [...prev, { facet: event.facet, oldVersion: event.oldVersion }])
        return
      case 'adapter-complete':
        setAdaptersByFacet((prev) => {
          const existing = prev[event.facet] ?? []
          if (existing.includes(event.adapter)) return prev
          return { ...prev, [event.facet]: [...existing, event.adapter] }
        })
        return
      case 'asset-installed':
      case 'asset-deleted':
      case 'lockfile-write':
      case 'receipt-invalid-asset':
      case 'install-complete':
        // No per-event UI for these; the final result render (or the
        // verbose log, for rejected receipt entries) covers them.
        return
    }
  }, [])

  /**
   * Verbose-log writer coordinated with Ink's rendering. Callers thread
   * this into the engine's `onLog` so verbose lines reach stderr without
   * racing the progress-bar repaint. `useStderr().write()` is Ink's
   * equivalent of `<Static>` for strings: it writes once, in order,
   * above the live region, on the stderr stream.
   */
  const onLog = useCallback(
    (line: string) => {
      writeToStderr(`${line}\n`)
    },
    [writeToStderr],
  )

  const start = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    try {
      const r = await run(onStage, onLog)
      setElapsedMs(Date.now() - startTimeRef.current)
      setResult(r)
      onComplete?.(r)
      // Defer exit so React paints the result state before Ink unmounts.
      setExitState(r.ok ? { kind: 'success' } : { kind: 'failure', error: new Error('Install failed') })
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      setExitState({ kind: 'failure', error: err })
    }
  }, [run, onStage, onLog, onComplete])

  useEffect(() => {
    if (exitState.kind === 'success') {
      exit()
      return
    }
    if (exitState.kind === 'failure') {
      exit(exitState.error)
      return
    }
    void start()
  }, [exitState, exit, start])

  const headerLabel = mode === 'add' ? 'Adding facets:' : mode === 'remove' ? 'Removing facets:' : 'Installing facets:'

  // Compute live counters: [done, remaining, failed].
  let doneCount = 0
  let failedCount = 0
  let currentFacet: FacetState | null = null
  for (const name of facetOrder) {
    const state = facets[name]
    if (!state) continue
    if (state.outcome) doneCount++
    else if (state.failure) failedCount++
    else currentFacet = state // last in-flight facet
  }
  const remainingCount = totalFacets - doneCount - failedCount

  // Current facet identity line (above the progress bar).
  const currentFacetInfo = currentFacet ? (
    <Text>
      <Text bold>{currentFacet.name}</Text>
      <Text color={THEME.hint}>@{currentFacet.specifier}</Text>
    </Text>
  ) : facetOrder.length > 0 ? (
    (() => {
      const last = facets[facetOrder[facetOrder.length - 1] ?? '']
      if (!last?.outcome) return null
      const version =
        last.outcome.kind === 'updated'
          ? last.outcome.newVersion
          : 'version' in last.outcome
            ? last.outcome.version
            : last.outcome.oldVersion
      return (
        <Text>
          <Text bold>{last.name}</Text>
          <Text color={THEME.hint}>@{version}</Text>
          <Text color={THEME.hint}> ({last.outcome.kind})</Text>
        </Text>
      )
    })()
  ) : null

  // Stage label for the progress bar line.
  const stageLabel = currentFacet ? (currentFacet.stage ? STAGE_LABELS[currentFacet.stage] : 'starting') : null

  return (
    <Box flexDirection="column">
      {result === null && (
        <Text bold color={THEME.brand}>
          {headerLabel}
        </Text>
      )}

      {result === null && (
        <Box flexDirection="column" marginLeft={2}>
          {currentFacetInfo ? (
            <Text>
              {currentFacetInfo}
              {stageLabel && <Text color={THEME.hint}> · {stageLabel}</Text>}
            </Text>
          ) : (
            <Text color={THEME.hint}>Preparing to {mode} facets</Text>
          )}
          <Box>
            <ProgressBar done={false} width={12} />
            {totalFacets > 0 && (
              <Text>
                {' '}
                <Text color={THEME.hint}>[</Text>
                <Text color={THEME.brand}>{remainingCount}</Text>
                <Text color={THEME.hint}>, </Text>
                <Text color={THEME.success}>{doneCount}</Text>
                <Text color={THEME.hint}>, </Text>
                <Text color={THEME.warning}>{failedCount}</Text>
                <Text color={THEME.hint}>]</Text>
              </Text>
            )}
          </Box>
        </Box>
      )}

      {serverWarnings.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {serverWarnings.map((w) => (
            <Text key={w.facet} color={THEME.warning}>
              ⚠ {w.facet}: {w.servers.length} server{w.servers.length === 1 ? '' : 's'} declared ({w.servers.join(', ')}
              ) — server installation not yet supported, skipping.
            </Text>
          ))}
        </Box>
      )}

      {result?.ok && (
        <SuccessSummary
          result={result}
          mode={mode}
          adapterCount={new Set(Object.values(adaptersByFacet).flat()).size}
          elapsedMs={elapsedMs}
        />
      )}
      {result && isPrepareFailure(result) && <AddPrepareFailureBlock failure={result.prepareFailure} />}
      {result && isRemovePrepareFailure(result) && <RemovePrepareFailureBlock failure={result.removePrepareFailure} />}
      {result && isInstallFailure(result) && <FailureBlock failure={result.failure} />}
      {result && isInstallFailure(result) && result.rollback.kind === 'partial-failure' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning}>
            ⚠ rollback completed with {result.rollback.failures} partial failure
            {result.rollback.failures === 1 ? '' : 's'} ({result.rollback.entriesUndone} entr
            {result.rollback.entriesUndone === 1 ? 'y' : 'ies'} successfully undone)
          </Text>
          <Text color={THEME.hint}> Some adapter writes could not be undone. Inspect the project tree.</Text>
        </Box>
      )}
    </Box>
  )
}

function SuccessSummary({
  result,
  mode,
  adapterCount,
  elapsedMs,
}: {
  result: RunInstallResult & { ok: true }
  mode: 'add' | 'install' | 'remove'
  adapterCount: number
  elapsedMs: number
}) {
  const { summary } = result
  const isNoOp = summary.installed === 0 && summary.updated === 0 && summary.repaired === 0 && summary.removed === 0
  const elapsed = `${(elapsedMs / 1000).toFixed(2)}s`

  if (isNoOp) {
    return (
      <Text>
        Checked <Text color={THEME.success}>{result.perFacet.length}</Text> facet
        {result.perFacet.length === 1 ? '' : 's'} across <Text color={THEME.success}>{adapterCount}</Text> adapter
        {adapterCount === 1 ? '' : 's'} <Text color={THEME.hint}>(no changes)</Text>{' '}
        <Text color={THEME.hint}>[{elapsed}]</Text>
      </Text>
    )
  }
  const touched = touchedFacetNames(result)
  const counts = countAssetsByType(result)
  const bundleVizNode = formatColoredBundleViz(counts)

  const removedNames = result.perFacet.filter((o) => o.kind === 'removed').map((o) => o.name)

  const actionLabel =
    mode === 'add'
      ? `${touched.join(', ')} installed.`
      : mode === 'remove'
        ? `${removedNames.join(', ')} removed.`
        : 'Install complete.'
  const registrationSuffix =
    adapterCount > 0 ? ` Updated facets via ${adapterCount} adapter${adapterCount === 1 ? '' : 's'}` : ''

  // Timer line: "Installed N facets" or "Removed N facets"
  const timerVerb = mode === 'remove' ? 'Removed' : 'Installed'
  const timerCount = mode === 'remove' ? removedNames.length : touched.length

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={THEME.success} bold>
          {actionLabel}
        </Text>
        <Text color={THEME.hint}>{registrationSuffix}</Text>
        {adapterCount > 0 && (
          <Text>
            {'  '}
            <Text color={THEME.success}>✓</Text>
          </Text>
        )}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text color={THEME.hint}>{summaryLine(summary)}</Text>
        {bundleVizNode}
      </Box>
      <Text>
        {timerVerb} <Text color={THEME.success}>{timerCount}</Text> facet
        {timerCount === 1 ? '' : 's'} across <Text color={THEME.success}>{adapterCount}</Text> adapter
        {adapterCount === 1 ? '' : 's'} <Text color={THEME.hint}>[{elapsed}]</Text>
      </Text>
    </Box>
  )
}

interface AssetCounts {
  skill: number
  agent: number
  command: number
}

function countAssetsByType(result: RunInstallResult & { ok: true }): AssetCounts {
  const counts: AssetCounts = { skill: 0, agent: 0, command: 0 }
  for (const name of touchedFacetNames(result)) {
    const facet = result.lockfile.facets[name]
    if (facet === undefined) continue
    for (const asset of facet.assets) {
      counts[asset.type]++
    }
  }
  return counts
}

/**
 * Names of facets actually written to disk in this run — installed,
 * updated, or repaired. `unchanged` contributes no new assets and
 * `removed` is rendered separately.
 */
function touchedFacetNames(result: RunInstallResult & { ok: true }): ReadonlyArray<string> {
  const names: string[] = []
  for (const outcome of result.perFacet) {
    if (outcome.kind === 'installed' || outcome.kind === 'updated' || outcome.kind === 'repaired') {
      names.push(outcome.name)
    }
  }
  return names
}

/**
 * Render a per-asset-type colored bundle viz. Returns null (no JSX)
 * when all counts are zero.
 */
function formatColoredBundleViz(counts: AssetCounts): React.ReactNode {
  const KINDS: ReadonlyArray<{ key: keyof AssetCounts; singular: string; plural: string; color: string }> = [
    { key: 'skill', singular: 'skill', plural: 'skills', color: ASSET_TYPE_COLORS.skill },
    { key: 'agent', singular: 'agent', plural: 'agents', color: ASSET_TYPE_COLORS.agent },
    { key: 'command', singular: 'command', plural: 'commands', color: ASSET_TYPE_COLORS.command },
  ]
  const parts: React.ReactNode[] = []
  for (const { key, singular, plural, color } of KINDS) {
    const n = counts[key]
    if (n > 0) {
      if (parts.length > 0)
        parts.push(
          <Text key={`sep-${key}`} color={THEME.hint}>
            {' · '}
          </Text>,
        )
      parts.push(
        <Text key={key} color={color}>
          {n} {n === 1 ? singular : plural}
        </Text>,
      )
    }
  }
  if (parts.length === 0) return null
  return (
    <Text>
      <Text color={THEME.hint}>+ </Text>
      {parts}
    </Text>
  )
}

function summaryLine(summary: {
  installed: number
  updated: number
  repaired: number
  unchanged: number
  removed: number
  totalAssets: number
}): string {
  const parts: string[] = []
  if (summary.installed > 0) parts.push(`${summary.installed} installed`)
  if (summary.updated > 0) parts.push(`${summary.updated} updated`)
  if (summary.repaired > 0) parts.push(`${summary.repaired} repaired`)
  if (summary.unchanged > 0) parts.push(`${summary.unchanged} unchanged`)
  if (summary.removed > 0) parts.push(`${summary.removed} removed`)
  parts.push(`${summary.totalAssets} asset${summary.totalAssets === 1 ? '' : 's'} written`)
  return parts.join(' · ')
}
