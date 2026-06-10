import { BRAND } from '@agent-facets/brand'
import { Text } from 'ink'
import Gradient from 'ink-gradient'
import { useEffect, useState } from 'react'
import { THEME } from '../theme.ts'

/** Animation tick interval — 50ms ≈ 20fps. */
const TICK_MS = 50

/** Default track width in columns. */
const DEFAULT_WIDTH = 24

/** The block character used for every comet cell. */
const BLOCK = '■'

/** Number of block cells in the comet. */
const COMET_LENGTH = 5

/** The dot character used for the dim track. */
const DOT = '·'

/** Two-stop gradient: purple → coral. */
const BAR_GRADIENT = [BRAND.purple, BRAND.coral]

export interface ProgressBarProps {
  /** Whether the work is complete. When true, the component renders nothing. */
  done: boolean
  /** Total track width in columns. Defaults to 24. */
  width?: number
}

/**
 * Indeterminate animated progress indicator. A gradient-colored comet
 * sweeps left→right across a dim dot track, then loops after a short
 * pause. The comet is rendered via `ink-gradient` with the brand
 * purple → coral sweep. When `done`, renders nothing.
 */
export function ProgressBar({ done, width = DEFAULT_WIDTH }: ProgressBarProps) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (done) return
    const interval = setInterval(() => {
      setTick((t) => t + 1)
    }, TICK_MS)
    return () => clearInterval(interval)
  }, [done])

  if (done) {
    return null
  }

  // The head sweeps left→right. The cycle is long enough for the
  // entire comet to slide off the right edge, plus a short pause.
  const GAP = 6
  const cycleLength = width + COMET_LENGTH + GAP
  // Each tick is one movement step at ~20fps.
  const step = tick
  const headPos = (step % cycleLength) - (COMET_LENGTH - 1)

  // The comet occupies columns [headPos - (COMET_LENGTH-1), headPos],
  // clamped to [0, width-1]. Visible length shrinks at edges.
  const visStart = Math.max(0, headPos - (COMET_LENGTH - 1))
  const visEnd = Math.min(width - 1, headPos)
  const visLen = Math.max(0, visEnd - visStart + 1)

  // Total is always `width`: dots = width - visLen
  const dotsBefore = visStart
  const dotsAfter = width - visLen - dotsBefore

  if (visLen === 0) {
    return <Text color={THEME.hint}>{DOT.repeat(width)}</Text>
  }

  const before = DOT.repeat(dotsBefore)
  const segment = BLOCK.repeat(visLen)
  const after = DOT.repeat(dotsAfter)

  return (
    <Text>
      <Text color={THEME.hint}>{before}</Text>
      <Gradient colors={BAR_GRADIENT}>{segment}</Gradient>
      <Text color={THEME.hint}>{after}</Text>
    </Text>
  )
}
