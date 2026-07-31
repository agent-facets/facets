import type { AssetType } from '@agent-facets/common'
import type {
  AddPrepareFailure,
  CollisionResolution,
  CollisionResolutionRequest,
  CollisionResolver,
  RemovePrepareFailure,
  RunInstallResult,
  StageEvent,
} from '@agent-facets/engine'
import { LOCKFILE_VERSION_0_3 } from '@agent-facets/protocol'
import { Box, Text, useApp, useStderr } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ProgressBar } from '../../components/progress-bar.tsx'
import { ASSET_TYPE_COLORS, THEME } from '../../theme.ts'
import { AddPrepareFailureBlock } from './add-prepare-failure-block.tsx'
import { CollisionWorkspace } from './collision/workspace.tsx'
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
   * Driver: caller supplies a `runInstall`-equivalent closure that takes
   * an `onStage` callback, an optional `onLog` callback, and a collision
   * resolver, and returns the result. The view runs it once on mount and
   * surfaces its events / outcome. When verbose output is enabled, the
   * caller should thread `onLog` into the engine call; the view routes it
   * through Ink's stderr writer so it doesn't race the progress bar
   * repaint.
   *
   * The resolver is OFFERED, not imposed. The view can always drive a
   * workspace — it owns the mount — but only the command knows whether
   * this invocation may prompt at all (an interactive terminal, and not
   * frozen mode). So the command decides whether to forward it to the
   * engine; a resolver that is never passed on is simply never called.
   */
  run: (
    onStage: (event: StageEvent) => void,
    onLog: ((build: () => string) => void) | undefined,
    resolveCollisions: CollisionResolver,
  ) => Promise<InstallViewResult>
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
  /**
   * The command's interrupt signal. Watched only to settle a pending
   * collision prompt: an interrupt raised while the engine is blocked on
   * the resolver would otherwise leave the promise unsettled forever,
   * holding the project lock with nothing left to release it.
   */
  signal?: AbortSignal
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

/** A materialization choice dropped because its asset no longer exists. */
interface PrunedOverride {
  facet: string
  assetType: AssetType
  authoredName: string
}

/**
 * What the single Ink mount is currently showing.
 *
 * Tagged rather than a set of booleans because the resolution phase
 * carries data nothing else does — the request being answered and the
 * function that answers it — and those must not be reachable while the
 * view is drawing progress or a result. Before this, "am I finished?"
 * was `result === null` and "what do I tell Ink?" was a second
 * `exitState`; the two could disagree.
 */
type ViewPhase =
  | { kind: 'progress' }
  | {
      kind: 'resolution'
      request: CollisionResolutionRequest
      /** Settles the engine's pending call. Idempotent. */
      settle: (resolution: CollisionResolution) => void
    }
  | { kind: 'result'; result: InstallViewResult }
  /** The driver threw rather than returning a structured failure. */
  | { kind: 'crashed'; error: Error }

export function InstallView({ run, mode, onComplete, signal }: InstallViewProps) {
  const { exit } = useApp()
  const { write: writeToStderr } = useStderr()
  const [totalFacets, setTotalFacets] = useState(0)
  const [facetOrder, setFacetOrder] = useState<string[]>([])
  const [facets, setFacets] = useState<Record<string, FacetState>>({})
  const [serverWarnings, setServerWarnings] = useState<ServerWarning[]>([])
  const [_driftRemovals, setDriftRemovals] = useState<DriftRemoval[]>([])
  /** Per-facet adapter completions: facetName → list of adapter names done. */
  const [adaptersByFacet, setAdaptersByFacet] = useState<Record<string, string[]>>({})
  const [phase, setPhase] = useState<ViewPhase>({ kind: 'progress' })
  const [checkingCollisions, setCheckingCollisions] = useState(false)
  const [prunedOverrides, setPrunedOverrides] = useState<PrunedOverride[]>([])
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedRef = useRef(false)
  const startTimeRef = useRef(Date.now())

  const result = phase.kind === 'result' ? phase.result : null

  const onStage = useCallback((event: StageEvent) => {
    switch (event.kind) {
      case 'install-start':
        setTotalFacets(event.totalFacets)
        return
      case 'collision-check':
        // Composition happens between the last fetch and the first write.
        // On a large project it is the one step with no per-facet event,
        // so without this it reads as a stall.
        setCheckingCollisions(true)
        return
      case 'stale-override-pruned':
        // A silent change to what `facets.json` says. It has to be
        // visible without `--verbose`, so it is state, not a log line.
        setPrunedOverrides((prev) => [
          ...prev,
          { facet: event.facet, assetType: event.assetType, authoredName: event.authoredName },
        ])
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
        setCheckingCollisions(false)
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
      default: {
        // Exhaustiveness guard. Without it a newly added stage event
        // compiles as silently ignored — which is exactly how
        // `stale-override-pruned` reached the view unrendered.
        const _exhaustive: never = event
        return _exhaustive
      }
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
    (build: () => string) => {
      writeToStderr(`${build()}\n`)
    },
    [writeToStderr],
  )

  /**
   * Hand the engine a way to ask the user, without leaving this mount.
   *
   * The engine is holding the project lock and awaiting this promise, so
   * the promise MUST settle on every path — confirm, cancel, Ctrl-C, or
   * an interrupt. `settled` guards that it settles exactly once: a second
   * resolve would be ignored by the promise but would also flip the view
   * back to progress a second time, out from under whatever came next.
   */
  const resolveCollisions = useCallback<CollisionResolver>((request) => {
    return new Promise<CollisionResolution>((resolve) => {
      let settled = false
      const settle = (resolution: CollisionResolution) => {
        if (settled) return
        settled = true
        setCheckingCollisions(false)
        setPhase({ kind: 'progress' })
        resolve(resolution)
      }
      setPhase({ kind: 'resolution', request, settle })
    })
  }, [])

  const start = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    try {
      const r = await run(onStage, onLog, resolveCollisions)
      setElapsedMs(Date.now() - startTimeRef.current)
      onComplete?.(r)
      // Defer exit so React paints the result state before Ink unmounts.
      setPhase({ kind: 'result', result: r })
    } catch (error) {
      setPhase({ kind: 'crashed', error: error instanceof Error ? error : new Error(String(error)) })
    }
  }, [run, onStage, onLog, onComplete, resolveCollisions])

  useEffect(() => {
    if (phase.kind === 'result') {
      if (phase.result.ok) exit()
      else exit(new Error('Install failed'))
      return
    }
    if (phase.kind === 'crashed') {
      exit(phase.error)
      return
    }
    void start()
  }, [phase, exit, start])

  /**
   * An interrupt while the workspace is open cancels the prompt rather
   * than killing the process. The engine then returns a structured
   * cancellation, unwinds, and releases the lock through its own
   * `finally` — which a hard exit here would have skipped.
   */
  useEffect(() => {
    if (signal === undefined || phase.kind !== 'resolution') return
    const { settle } = phase
    const onAbort = () => settle({ kind: 'cancelled' })
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    return () => signal.removeEventListener('abort', onAbort)
  }, [signal, phase])

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

  // The workspace owns the screen while it is open: mixing a live
  // progress bar into a form the user is typing into repaints under the
  // cursor. Progress resumes, in this same mount, once it closes.
  if (phase.kind === 'resolution') {
    return <CollisionWorkspace request={phase.request} onComplete={phase.settle} />
  }

  return (
    <Box flexDirection="column">
      {result === null && (
        <Text bold color={THEME.brand}>
          {headerLabel}
        </Text>
      )}

      {result === null && (
        <Box flexDirection="column" marginLeft={2}>
          {checkingCollisions ? (
            <Text color={THEME.hint}>Checking for name collisions across all facets</Text>
          ) : currentFacetInfo ? (
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

      {prunedOverrides.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {prunedOverrides.map((pruned) => (
            <Text key={`${pruned.facet}:${pruned.assetType}:${pruned.authoredName}`} color={THEME.caution}>
              ⚠ dropped the materialization choice for {pruned.assetType} “{pruned.authoredName}” in {pruned.facet} —
              this version no longer contains that asset.
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
      {/* The partial-rollback note used to live here as well, restating what
          the failure block already claimed. `FailureBlock` now renders the
          disk state once, for every failure code, from the shared helper. */}
      {result && isInstallFailure(result) && <FailureBlock result={result} />}
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
  const notes = materializationNotes(result)

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
        {/* Aliases and omissions are the one thing a user cannot infer
            from the file tree: an asset is missing, or present under a
            name they did not publish. Naming both sides makes the
            outcome checkable. */}
        {notes.map((note) => (
          <Text key={`${note.facet}:${note.type}:${note.authoredName}`} color={THEME.hint}>
            {note.facet} {note.type} {note.authoredName}
            {note.effectiveName === null ? (
              <Text color={THEME.caution}> — omitted</Text>
            ) : (
              <Text>
                {' → '}
                <Text color={THEME.success}>{note.effectiveName}</Text>
              </Text>
            )}
          </Text>
        ))}
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

/**
 * How one asset was materialized, for the summary.
 *
 * `effectiveName: null` means omitted. Only a current lockfile records
 * dispositions at all; a legacy one is authored by definition, which is
 * why this is derived from the lockfile rather than carried separately.
 */
interface MaterializationNote {
  facet: string
  type: AssetType
  authoredName: string
  effectiveName: string | null
}

function materializationNotes(result: RunInstallResult & { ok: true }): MaterializationNote[] {
  // Legacy lockfiles cannot express an alias or an omission, so there is
  // nothing to report — not "nothing happened", but "this format has no
  // opinion". Frozen mode returns the lockfile it read, so this branch is
  // reachable in normal use, not just during migration.
  if (result.lockfile.lockfileVersion !== LOCKFILE_VERSION_0_3) return []

  const notes: MaterializationNote[] = []
  for (const [facet, entry] of Object.entries(result.lockfile.facets)) {
    for (const asset of entry.assets) {
      if (asset.materialization.kind === 'authored') continue
      notes.push({
        facet,
        type: asset.type,
        authoredName: asset.name,
        effectiveName: asset.materialization.kind === 'aliased' ? asset.materialization.as : null,
      })
    }
  }
  return notes
}

function countAssetsByType(result: RunInstallResult & { ok: true }): AssetCounts {
  const counts: AssetCounts = { skill: 0, agent: 0, command: 0 }
  const omitted = new Set(
    materializationNotes(result)
      .filter((note) => note.effectiveName === null)
      .map((note) => `${note.facet}\u0000${note.type}\u0000${note.authoredName}`),
  )
  for (const name of touchedFacetNames(result)) {
    const facet = result.lockfile.facets[name]
    if (facet === undefined) continue
    for (const asset of facet.assets) {
      // An omitted asset stays in the lockfile — it is part of the
      // resolved set — but nothing was written for it, so counting it
      // here would claim a file that does not exist on disk.
      if (omitted.has(`${name}\u0000${asset.type}\u0000${asset.name}`)) continue
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
