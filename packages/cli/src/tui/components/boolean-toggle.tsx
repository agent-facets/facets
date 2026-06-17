import { Box, Text, useInput } from 'ink'
import { useFocusOrder } from '../context/focus-order-context.ts'
import { THEME } from '../theme.ts'

/**
 * A focusable two-state toggle that participates in the wizard focus order.
 *
 * Keyboard model (active only while focused):
 * - Enter advances focus via `onConfirm` (the wizard reaches this field by
 *   pressing Enter, so Enter continuing the flow keeps that rhythm).
 * - Space, Tab, and Left/Right flip the value via `onToggle`. Tab is claimed
 *   here (see `TAB_TOGGLE_FOCUS_IDS` in the focus-order context) so it toggles
 *   instead of advancing. ↓ still advances and Shift+Tab still moves back.
 */
export function BooleanToggle({
  id,
  label,
  value,
  onLabel,
  offLabel,
  onToggle,
  onConfirm,
  hint,
  dimmed,
}: {
  id: string
  label: string
  value: boolean
  /** Text shown when `value` is true. */
  onLabel: string
  /** Text shown when `value` is false. */
  offLabel: string
  onToggle: (next: boolean) => void
  onConfirm?: () => void
  hint?: string
  dimmed?: boolean
}) {
  const { focusedId } = useFocusOrder()
  const isFocused = focusedId === id

  useInput(
    (input, key) => {
      if (key.return) {
        onConfirm?.()
        return
      }
      if (input === ' ' || key.tab || key.leftArrow || key.rightArrow) {
        onToggle(!value)
      }
    },
    { isActive: isFocused },
  )

  const dim = dimmed && !isFocused

  return (
    <Box gap={1} marginLeft={2}>
      <Text color={isFocused ? THEME.focus : undefined} bold={isFocused} dimColor={dim}>
        {label}:
      </Text>
      <Text color={dim ? undefined : value ? THEME.warning : THEME.success} dimColor={dim}>
        {value ? onLabel : offLabel}
      </Text>
      {isFocused && hint && <Text color={THEME.hint}>{hint}</Text>}
      {isFocused && (
        <Text color={THEME.hint}>
          · <Text color={THEME.keyword}>Space</Text> to toggle · <Text color={THEME.keyword}>Enter</Text> to continue
        </Text>
      )}
    </Box>
  )
}
