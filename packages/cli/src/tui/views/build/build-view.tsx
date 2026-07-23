import type { Adapter } from '@agent-facets/adapter'
import type { AdapterCompatibilityFailure } from '@agent-facets/engine'
import {
  BUILD_STAGES,
  type BuildProgress,
  type BuildStage,
  runBuildPipeline,
  writeBuildOutput,
} from '@agent-facets/engine'
import { Box, Text, useApp } from 'ink'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildFailureMessages, describeCompatibilityFailure } from '../../../util/adapter-install-errors.ts'
import type { Stage } from '../../components/stage-row.tsx'
import { StageRow } from '../../components/stage-row.tsx'
import { THEME } from '../../theme.ts'

interface BuildViewResult {
  name: string
  version: string
  facetVersion: number
  /** Complete inner-archive entry listing (manifest, primaries, supplementary). */
  files: string[]
  archiveFilename: string
  integrity: string
  warnings: string[]
}

export function BuildView({
  rootDir,
  emitManifest = false,
  adapters,
  onSuccess,
  onFailure,
}: {
  rootDir: string
  emitManifest?: boolean
  adapters: Adapter[]
  onSuccess?: (name: string, version: string, fileCount: number, integrity: string) => void
  onFailure?: (errorCount: number) => void
}) {
  const { exit } = useApp()
  const [stages, setStages] = useState<Stage[]>(BUILD_STAGES.map((label) => ({ label, status: 'pending' as const })))
  const [result, setResult] = useState<BuildViewResult | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  // Adapter-incompatibility is a preflight failure that fires before any
  // build stage runs — rendered as its own block, not attributed to a stage.
  const [preflightFailures, setPreflightFailures] = useState<AdapterCompatibilityFailure[] | null>(null)

  // Deferred exit: set this to an Error to exit after the next render cycle,
  // ensuring error/stage state updates are painted before Ink unmounts.
  const [pendingExit, setPendingExit] = useState<Error | null>(null)

  // Build a stable lookup from stage label to index
  const stageIndexMap = useMemo(() => Object.fromEntries(BUILD_STAGES.map((label, i) => [label, i])), [])

  const updateStage = useCallback(
    (label: BuildStage, update: Partial<Stage>) => {
      const index = stageIndexMap[label]
      if (index !== undefined) {
        setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...update } : s)))
      }
    },
    [stageIndexMap],
  )

  const run = useCallback(async () => {
    const pipelineResult = await runBuildPipeline(rootDir, adapters, (progress: BuildProgress) => {
      updateStage(progress.stage, {
        status: progress.status === 'running' ? 'running' : progress.status === 'done' ? 'done' : 'failed',
      })
    })

    setWarnings(pipelineResult.warnings)

    if (!pipelineResult.ok) {
      if (pipelineResult.kind === 'adapter-incompatible') {
        // Preflight failed before any stage ran — do not mark a build
        // stage failed; surface a distinct compatibility block instead.
        setPreflightFailures(pipelineResult.failures)
        onFailure?.(pipelineResult.failures.length)
        setPendingExit(new Error('Build failed'))
        return
      }
      const formatted = buildFailureMessages(pipelineResult)
      // Validation failures attach to the stage that actually failed.
      setStages((prev) => {
        const anyFailed = prev.some((s) => s.status === 'failed')
        return prev.map((s, i) =>
          (anyFailed ? s.status === 'failed' : i === 0) ? { ...s, status: 'failed' as const, errors: formatted } : s,
        )
      })
      onFailure?.(formatted.length)
      // Defer exit so React renders the errors and failed stage status first
      setPendingExit(new Error('Build failed'))
      return
    }

    // Writing output stage — handled here, not by the pipeline
    updateStage('Writing output', { status: 'running' })
    try {
      await writeBuildOutput(pipelineResult, rootDir, { emitManifest })

      const files = Object.keys(pipelineResult.fileHashes).sort()

      updateStage('Writing output', { status: 'done' })
      setResult({
        name: pipelineResult.data.name,
        version: pipelineResult.data.version,
        facetVersion: pipelineResult.facetVersion,
        files,
        archiveFilename: pipelineResult.archiveFilename,
        integrity: pipelineResult.integrity,
        warnings: pipelineResult.warnings,
      })
      onSuccess?.(pipelineResult.data.name, pipelineResult.data.version, files.length, pipelineResult.integrity)
      exit()
    } catch (err) {
      updateStage('Writing output', { status: 'failed', detail: String(err) })
      setPendingExit(err instanceof Error ? err : new Error(String(err)))
    }
  }, [
    adapters,
    emitManifest,
    exit,
    onFailure,
    onSuccess,
    rootDir, // Writing output stage — handled here, not by the pipeline
    updateStage,
  ])

  useEffect(() => {
    if (pendingExit) {
      exit(pendingExit)
      return
    }

    run()
  }, [pendingExit, exit, run])

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color={THEME.brand}>
        Building facet...
      </Text>

      <Box flexDirection="column">
        {stages.map((s) => (
          <StageRow key={s.label} stage={s} />
        ))}
      </Box>

      {warnings.length > 0 && (
        <Box flexDirection="column">
          {warnings.map((w) => (
            <Text key={w} color={THEME.warning}>
              {' '}
              ⚠ {w}
            </Text>
          ))}
        </Box>
      )}

      {preflightFailures && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.warning} bold>
            ✕ incompatible adapter{preflightFailures.length !== 1 ? 's' : ''} — build did not start
          </Text>
          {preflightFailures.map((compat) => {
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
      )}

      {result && (
        <Box flexDirection="column">
          <Text color={THEME.success} bold>
            Built successfully → dist/
          </Text>
          <Text> {result.archiveFilename}</Text>
          <Text color={THEME.hint}> facetVersion {result.facetVersion}</Text>
          <Text color={THEME.hint}> Archive contents:</Text>
          {result.files.map((f) => (
            <Text key={f}> {f}</Text>
          ))}
          <Box marginTop={1}>
            <Text color={THEME.hint}>
              {result.files.length} entr{result.files.length !== 1 ? 'ies' : 'y'} · {result.integrity}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={THEME.hint}>Next: facet publish (coming soon)</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
