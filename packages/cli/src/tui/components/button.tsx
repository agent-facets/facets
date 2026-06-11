import { Box, Text, useInput } from 'ink'
import Gradient from 'ink-gradient'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useFocusOrder } from '../context/focus-order-context.ts'
import { GRADIENT_STOPS, getAnimatedGradient } from '../gradient.ts'
import { THEME } from '../theme.ts'

const ANIMATION_INTERVAL_MS = 75

export function Button({
  id,
  label,
  hint,
  onPress,
  disabled,
  color,
  gradient: showGradient,
  animateGradient,
}: {
  id: string
  label: string
  hint?: ReactNode
  onPress: () => void
  disabled?: boolean
  color?: string
  autoFocus?: boolean
  gradient?: boolean
  animateGradient?: boolean
}) {
  const { focusedId } = useFocusOrder()
  const isFocused = focusedId === id && !disabled
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!animateGradient) return
    const interval = setInterval(() => {
      setOffset((prev) => (prev + 1) % GRADIENT_STOPS.length)
    }, ANIMATION_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [animateGradient])

  useInput(
    (_input, key) => {
      if (key.return) {
        onPress()
      }
    },
    { isActive: isFocused },
  )

  const prefix = isFocused ? '▸ ' : '  '

  const focusHint = isFocused && hint ? <Text> {hint}</Text> : null

  if (disabled) {
    return (
      <Box gap={0}>
        <Text color="gray" dimColor>
          {prefix}
          {label}
        </Text>
      </Box>
    )
  }

  if (showGradient) {
    const colors = animateGradient ? getAnimatedGradient(offset) : [...THEME.gradient]

    return (
      <Box gap={0}>
        <Gradient colors={colors}>
          <Text bold>
            {prefix}
            {label}
          </Text>
        </Gradient>
        {focusHint}
      </Box>
    )
  }

  return (
    <Box gap={0}>
      <Text color={isFocused ? (color ?? THEME.focus) : undefined} bold={isFocused}>
        {prefix}
        {label}
      </Text>
      {focusHint}
    </Box>
  )
}
