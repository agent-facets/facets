import type { RunInstallResult, StageEvent } from '@agent-facets/core'
import { Box, Text, useApp } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'
import { THEME } from '../../theme.ts'
import { FacetRow, type FacetState } from './facet-row.tsx'
import { FailureBlock } from './failure-block.tsx'

export interface InstallViewProps {
  /**
   * Driver: caller supplies `runInstall`-equivalent closure that takes
   * an `onStage` callback and returns the result. The view runs it once
   * on mount and surfaces its events / outcome.
   */
  run: (onStage: (event: StageEvent) => void) => Promise<RunInstallResult>
  /**
   * Header copy hint. `'add'` renders "Adding facets..."; `'install'`
   * renders "Installing facets...". Functional behavior is identical.
   */
  mode: 'add' | 'install'
  /**
   * Fires once when the install completes, before Ink unmounts. Lets
   * the caller capture the result for exit-code mapping.
   */
  onComplete?: (result: RunInstallResult) => void
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
  const [facetOrder, setFacetOrder] = useState<string[]>([])
  const [facets, setFacets] = useState<Record<string, FacetState>>({})
  const [serverWarnings, setServerWarnings] = useState<ServerWarning[]>([])
  const [driftRemovals, setDriftRemovals] = useState<DriftRemoval[]>([])
  const [result, setResult] = useState<RunInstallResult | null>(null)
  const [exitState, setExitState] = useState<
    { kind: 'idle' } | { kind: 'success' } | { kind: 'failure'; error: Error }
  >({ kind: 'idle' })
  const startedRef = useRef(false)

  const onStage = useCallback((event: StageEvent) => {
    switch (event.kind) {
      case 'install-start':
        // Header is static; no per-event update needed.
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
      case 'asset-installed':
      case 'asset-deleted':
      case 'lockfile-write':
      case 'install-complete':
        // No per-event UI for these; the final result render covers them.
        return
    }
  }, [])

  const start = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    try {
      const r = await run(onStage)
      setResult(r)
      onComplete?.(r)
      // Defer exit so React paints the result state before Ink unmounts.
      setExitState(r.ok ? { kind: 'success' } : { kind: 'failure', error: new Error('Install failed') })
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      setExitState({ kind: 'failure', error: err })
    }
  }, [run, onStage, onComplete])

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

  const headerLabel = mode === 'add' ? 'Adding facets...' : 'Installing facets...'

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color={THEME.brand}>
        {headerLabel}
      </Text>

      {facetOrder.length > 0 && (
        <Box flexDirection="column">
          {facetOrder.map((name) => {
            const state = facets[name]
            if (!state) return null
            return <FacetRow key={name} state={state} />
          })}
        </Box>
      )}

      {serverWarnings.length > 0 && (
        <Box flexDirection="column">
          {serverWarnings.map((w) => (
            <Text key={w.facet} color={THEME.warning}>
              ⚠ {w.facet}: {w.servers.length} server{w.servers.length === 1 ? '' : 's'} declared ({w.servers.join(', ')}
              ) — server installation not yet supported, skipping.
            </Text>
          ))}
        </Box>
      )}

      {driftRemovals.length > 0 && (
        <Box flexDirection="column">
          {driftRemovals.map((d) => (
            <Text key={d.facet} color={THEME.hint}>
              - removed {d.facet}@{d.oldVersion} (no longer in facets.json)
            </Text>
          ))}
        </Box>
      )}

      {result?.ok && <SuccessSummary result={result} />}
      {result && !result.ok && <FailureBlock failure={result.failure} />}
      {result && !result.ok && !result.rollback.ok && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning}>
            ⚠ rollback completed with {result.rollback.partialFailures} partial failure
            {result.rollback.partialFailures === 1 ? '' : 's'}
          </Text>
          <Text color={THEME.hint}> Some adapter writes could not be undone. Inspect the project tree.</Text>
        </Box>
      )}
    </Box>
  )
}

function SuccessSummary({ result }: { result: RunInstallResult & { ok: true } }) {
  const { summary } = result
  const isNoOp = summary.installed === 0 && summary.updated === 0 && summary.repaired === 0 && summary.removed === 0
  if (isNoOp) {
    return (
      <Box flexDirection="column">
        <Text color={THEME.hint}>Nothing to install. facets.lock is in sync with facets.json.</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text color={THEME.success} bold>
        Done.
      </Text>
      <Text color={THEME.hint}>{summaryLine(summary)}</Text>
    </Box>
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
