import { Box, Text, useInput } from 'ink'
import Gradient from 'ink-gradient'
import { useEffect, useState } from 'react'
import { useFocusOrder } from '../context/focus-order-context.ts'
import { GRADIENT_STOPS, getAnimatedGradient } from '../gradient.ts'
import { THEME } from '../theme.ts'

const ANIMATION_INTERVAL_MS = 75

export interface ReconciliationOption {
  label: string
}

export function ReconciliationItemRow({
  id,
  description,
  detail,
  options,
  selectedIndex,
  onSelect,
}: {
  id: string
  /** Primary text for this item (e.g., file path or asset name) */
  description: string
  /** Optional secondary detail line below the description */
  detail?: string
  /** The two action options */
  options: [ReconciliationOption, ReconciliationOption]
  /** Index of currently selected option, or null if unresolved */
  selectedIndex: number | null
  /** Called when the user locks in an option */
  onSelect: (index: number) => void
}) {
  const { focusedId } = useFocusOrder()
  const isFocused = focusedId === id

  // Which option is highlighted (cursor position)
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex ?? 0)
  const [offset, setOffset] = useState(0)

  // Animate gradient when focused
  useEffect(() => {
    if (!isFocused) return
    const interval = setInterval(() => {
      setOffset((prev) => (prev + 1) % GRADIENT_STOPS.length)
    }, ANIMATION_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isFocused])

  useInput(
    (_input, key) => {
      if (key.leftArrow) setHighlightedIndex(0)
      if (key.rightArrow) setHighlightedIndex(1)
      if (key.return) onSelect(highlightedIndex)
    },
    { isActive: isFocused },
  )

  const animatedColors = getAnimatedGradient(offset)

  return (
    <Box flexDirection="column">
      <Box gap={2}>
        <Box gap={1}>
          {isFocused ? (
            <Text color={THEME.focus} bold>
              ▸
            </Text>
          ) : (
            <Text> </Text>
          )}
          <Text color={isFocused ? THEME.focus : undefined}>{description}</Text>
        </Box>

        <Box gap={2}>
          {options.map((opt, i) => {
            const isSelected = selectedIndex === i
            const isHighlighted = isFocused && highlightedIndex === i
            const isOther = selectedIndex !== null && !isSelected

            if (isHighlighted) {
              return (
                <Box key={opt.label} gap={1}>
                  {isSelected && <Text color={THEME.success}>✓</Text>}
                  <Gradient colors={animatedColors}>
                    <Text bold>{opt.label}</Text>
                  </Gradient>
                </Box>
              )
            }

            if (isSelected && !isFocused) {
              return (
                <Box key={opt.label} gap={1}>
                  <Text color={THEME.success}>✓</Text>
                  <Gradient colors={[...THEME.gradient]}>
                    <Text bold>{opt.label}</Text>
                  </Gradient>
                </Box>
              )
            }

            if (isOther) {
              return (
                <Text key={opt.label} dimColor>
                  {opt.label}
                </Text>
              )
            }

            // Unresolved, unfocused
            return (
              <Box key={opt.label} gap={1}>
                {isSelected && <Text color={THEME.success}>✓</Text>}
                <Text>{opt.label}</Text>
              </Box>
            )
          })}
        </Box>
      </Box>

      {detail && (
        <Box marginLeft={2}>
          <Text dimColor>{detail}</Text>
        </Box>
      )}
    </Box>
  )
}
