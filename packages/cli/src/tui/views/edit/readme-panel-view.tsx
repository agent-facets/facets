import {
  type ReadmeAction,
  type ReadmeActionOption,
  type ReadmeFileState,
  type ReadmePath,
  readmeActionOptions,
  readmeOptionKindFor,
} from '@agent-facets/engine'
import { Box, Text, useInput } from 'ink'
import Gradient from 'ink-gradient'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/button.tsx'
import { useFocusOrder } from '../../context/focus-order-context.ts'
import { GRADIENT_STOPS, getAnimatedGradient } from '../../gradient.ts'
import { THEME } from '../../theme.ts'

const ANIMATION_INTERVAL_MS = 75

/** Human-readable summary of a README path's current on-disk/declaration state. */
function stateLabel(state: ReadmeFileState): string {
  switch (state.state) {
    case 'present-declared':
      return 'present, declared'
    case 'present-undeclared':
      return 'present, not declared'
    case 'declared-missing':
      return 'declared, missing on disk'
    case 'absent-undeclared':
      return 'absent'
  }
}

/**
 * One README path row. Renders the path, its current state, and its legal
 * action options (1 or 2 per state). Left/right move the highlight; Enter
 * selects. Content-bearing options are marked so the parent opens the editor.
 * `none` (leave as-is) is always available as an implicit first choice so an
 * author can decline to touch a path.
 */
function ReadmeRow({
  id,
  state,
  action,
  onSelect,
}: {
  id: string
  state: ReadmeFileState
  action: ReadmeAction | undefined
  onSelect: (option: ReadmeActionOption) => void
}) {
  const { focusedId } = useFocusOrder()
  const isFocused = focusedId === id
  const options = useMemo(() => readmeActionOptions(state), [state])

  const selectedKind = action ? readmeOptionKindFor(action) : null
  const selectedIndex = selectedKind ? options.findIndex((o) => o.kind === selectedKind) : -1

  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!isFocused) return
    const interval = setInterval(() => {
      setOffset((prev) => (prev + 1) % GRADIENT_STOPS.length)
    }, ANIMATION_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isFocused])

  useInput(
    (_input, key) => {
      if (key.leftArrow) setHighlightedIndex((i) => Math.max(0, i - 1))
      if (key.rightArrow) setHighlightedIndex((i) => Math.min(options.length - 1, i + 1))
      if (key.return) {
        const option = options[highlightedIndex]
        if (option) onSelect(option)
      }
    },
    { isActive: isFocused },
  )

  const animatedColors = getAnimatedGradient(offset)
  const leaveSelected = action === undefined || action.kind === 'none'

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
          <Text color={isFocused ? THEME.focus : undefined}>{state.path}</Text>
        </Box>

        <Box gap={2}>
          {options.map((opt, i) => {
            const isSelected = selectedIndex === i
            const isHighlighted = isFocused && highlightedIndex === i
            if (isHighlighted) {
              return (
                <Box key={opt.kind} gap={1}>
                  {isSelected && <Text color={THEME.success}>✓</Text>}
                  <Gradient colors={animatedColors}>
                    <Text bold>{opt.label}</Text>
                  </Gradient>
                </Box>
              )
            }
            if (isSelected) {
              return (
                <Box key={opt.kind} gap={1}>
                  <Text color={THEME.success}>✓</Text>
                  <Gradient colors={[...THEME.gradient]}>
                    <Text bold>{opt.label}</Text>
                  </Gradient>
                </Box>
              )
            }
            return (
              <Text key={opt.kind} dimColor>
                {opt.label}
              </Text>
            )
          })}
        </Box>
      </Box>

      <Box marginLeft={2}>
        <Text dimColor>
          {stateLabel(state)}
          {leaveSelected ? ' · leaving as-is' : ''}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * The dedicated facet-level README panel (design D11). Shows both conventional
 * README paths independently, each with its legal actions. Content-bearing
 * choices request the external editor via `onEditReadme`; all others are queued
 * immediately via `onResolve`. No disk or manifest change happens here — every
 * choice is queued until the confirmation Apply.
 */
export function ReadmePanelView({
  states,
  actions,
  onResolve,
  onEditReadme,
  onContinue,
}: {
  states: ReadmeFileState[]
  actions: Map<ReadmePath, ReadmeAction>
  onResolve: (path: ReadmePath, option: ReadmeActionOption) => void
  onEditReadme: (path: ReadmePath, option: ReadmeActionOption) => void
  onContinue: () => void
}) {
  const { setFocusIds, focusedId, focus } = useFocusOrder()

  const focusIds = useMemo(() => {
    const ids = states.map((s) => `readme-${s.path}`)
    ids.push('readme-continue')
    return ids
  }, [states])

  useEffect(() => {
    setFocusIds(focusIds)
    if (!focusedId) focus(focusIds[0] ?? '')
  }, [focusIds, setFocusIds, focusedId, focus])

  const handleSelect = useCallback(
    (path: ReadmePath, option: ReadmeActionOption) => {
      if (option.requiresEditor) {
        onEditReadme(path, option)
      } else {
        onResolve(path, option)
      }
      focus('readme-continue')
    },
    [onResolve, onEditReadme, focus],
  )

  return (
    <Box flexDirection="column">
      <Text bold color={THEME.brand}>
        README
      </Text>
      <Box marginBottom={0}>
        <Text dimColor>Manage the conventional README files. Changes apply on the final confirmation.</Text>
      </Box>

      {states.map((state) => (
        <ReadmeRow
          key={state.path}
          id={`readme-${state.path}`}
          state={state}
          action={actions.get(state.path)}
          onSelect={(option) => handleSelect(state.path, option)}
        />
      ))}

      <Box marginTop={1}>
        <Button
          id="readme-continue"
          label="[ Continue to edit ]"
          gradient
          animateGradient={focusedId === 'readme-continue'}
          onPress={onContinue}
        />
      </Box>

      <Box>
        <Text dimColor>↑ ↓ navigate · ← → switch option · Enter select · Esc Esc exit</Text>
      </Box>
    </Box>
  )
}
