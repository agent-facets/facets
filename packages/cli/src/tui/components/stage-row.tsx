import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import type { ReactNode } from 'react'
import { THEME } from '../theme.ts'

export type StageStatus = 'pending' | 'running' | 'done' | 'failed'

export interface Stage {
  label: string
  status: StageStatus
  detail?: string
  errors?: string[]
}

const ICONS: Record<StageStatus, ReactNode> = {
  pending: <Text color={THEME.hint}>○</Text>,
  running: (
    <Text color={THEME.secondary}>
      <Spinner type="dots" />
    </Text>
  ),
  done: <Text color={THEME.success}>●</Text>,
  failed: <Text color={THEME.warning}>✕</Text>,
}

export function StageRow({ stage }: { stage: Stage }) {
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {ICONS[stage.status]}
        <Text dimColor={stage.status === 'pending'}>{stage.label}</Text>
        {stage.detail && <Text color={THEME.hint}> — {stage.detail}</Text>}
      </Box>
      {stage.errors && stage.errors.length > 0 && (
        <Box flexDirection="column" marginLeft={3}>
          {stage.errors.map((e) => (
            <Text key={e} color={THEME.warning}>
              {e}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
