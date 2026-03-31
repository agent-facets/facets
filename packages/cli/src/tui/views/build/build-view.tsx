import { type BuildProgress, runBuildPipeline, writeBuildOutput } from '@agent-facets/core'
import { Box, Text, useApp } from 'ink'
import { useCallback, useEffect, useState } from 'react'
import type { Stage } from '../../components/stage-row.tsx'
import { StageRow } from '../../components/stage-row.tsx'
import { THEME } from '../../theme.ts'

interface BuildViewResult {
  name: string
  version: string
  files: string[]
  archiveFilename: string
  integrity: string
  warnings: string[]
}

export function BuildView({
  rootDir,
  onSuccess,
  onFailure,
}: {
  rootDir: string
  onSuccess?: (name: string, version: string, fileCount: number, integrity: string) => void
  onFailure?: (errorCount: number) => void
}) {
  const { exit } = useApp()
  const [stages, setStages] = useState<Stage[]>([
    { label: 'Validating manifest', status: 'pending' },
    { label: 'Assembling archive', status: 'pending' },
    { label: 'Writing output', status: 'pending' },
  ])
  const [result, setResult] = useState<BuildViewResult | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  const updateStage = useCallback((index: number, update: Partial<Stage>) => {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...update } : s)))
  }, [])

  useEffect(() => {
    async function run() {
      // Stages 1 & 2: Validate and assemble archive (pipeline handles both, emits progress)
      const stageIndexMap: Record<string, number> = {
        'Validating manifest': 0,
        'Assembling archive': 1,
      }

      const pipelineResult = await runBuildPipeline(rootDir, (progress: BuildProgress) => {
        const index = stageIndexMap[progress.stage]
        if (index !== undefined) {
          updateStage(index, {
            status: progress.status === 'running' ? 'running' : progress.status === 'done' ? 'done' : 'failed',
          })
        }
      })

      setWarnings(pipelineResult.warnings)

      if (!pipelineResult.ok) {
        setErrors(pipelineResult.errors.map((e) => `${e.path ? `${e.path}: ` : ''}${e.message}`))
        onFailure?.(pipelineResult.errors.length)
        exit(new Error('Build failed'))
        return
      }

      // Stage 3: Write output
      updateStage(2, { status: 'running' })
      try {
        await writeBuildOutput(pipelineResult, rootDir)

        // Derive file list from asset hashes (these are the files inside the archive)
        const files = Object.keys(pipelineResult.assetHashes).sort()

        updateStage(2, { status: 'done' })
        setResult({
          name: pipelineResult.data.name,
          version: pipelineResult.data.version,
          files,
          archiveFilename: pipelineResult.archiveFilename,
          integrity: pipelineResult.integrity,
          warnings: pipelineResult.warnings,
        })
        onSuccess?.(pipelineResult.data.name, pipelineResult.data.version, files.length, pipelineResult.integrity)
        exit()
      } catch (err) {
        updateStage(2, { status: 'failed', detail: String(err) })
        exit(err instanceof Error ? err : new Error(String(err)))
      }
    }

    run()
  }, [rootDir, exit, onSuccess, onFailure, updateStage])

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

      {errors.length > 0 && (
        <Box flexDirection="column">
          <Text bold color={THEME.warning}>
            Errors:
          </Text>
          {errors.map((e) => (
            <Text key={e} color={THEME.warning}>
              {' '}
              {e}
            </Text>
          ))}
        </Box>
      )}

      {result && (
        <Box flexDirection="column">
          <Text color={THEME.success} bold>
            Built successfully → dist/
          </Text>
          <Text> {result.archiveFilename}</Text>
          <Text color={THEME.hint}> Archive contents:</Text>
          {result.files.map((f) => (
            <Text key={f}> {f}</Text>
          ))}
          <Box marginTop={1}>
            <Text color={THEME.hint}>
              {result.files.length} asset{result.files.length !== 1 ? 's' : ''} · {result.integrity}
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
