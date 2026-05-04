import { FIRST_PARTY_ADAPTERS, type FirstPartyAdapter } from '@agent-facets/engine'
import { Box, Text, useApp, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { THEME } from '../../tui/theme.ts'

/**
 * Shared zero-adapter install picker (Adjustment A + §11.5).
 *
 * Rendered in both entry paths where the user needs to pick which AI tool
 * adapter to install:
 *   - `facet adapter install` invoked with no argument.
 *   - `facet install` run in a project with no adapters installed.
 *
 * Header text is identical in both paths ("No AI tools are connected yet.")
 * so partners learn the adapter concept through a consistent framing.
 *
 * Keyboard contract:
 *   ↑↓      move the cursor (skips dimmed rows)
 *   Space   toggle selection on the focused row (no-op on dimmed rows)
 *   Enter   confirm: returns the selected adapter names
 *           Enter with zero selected flashes a soft-abort hint instead of
 *           exiting — only Esc / Ctrl-C cleanly aborts the picker.
 *   Esc /   cancel: hands back `null` so the caller prints the abort line.
 *   Ctrl-C
 */

export interface PickerProps {
  /** First-party adapter catalog. Tests override to exercise edge cases. */
  options?: readonly FirstPartyAdapter[]
  /**
   * Names of adapters already installed on disk. Rows matching these names
   * render with the "installed" styling (green + "(installed — select to update)"
   * label). The picker header also adapts: zero installed → "No AI tools are
   * connected yet…"; one-or-more → "Pick which adapter to install or update."
   */
  installedNames?: readonly string[]
  /** Fires once when the user confirms with a non-empty selection. */
  onConfirm: (selected: FirstPartyAdapter[]) => void
  /** Fires once when the user aborts (Esc / Ctrl-C). */
  onAbort: () => void
}

export function InstallPicker({
  options = FIRST_PARTY_ADAPTERS,
  installedNames = [],
  onConfirm,
  onAbort,
}: PickerProps) {
  const { exit } = useApp()

  const selectableIndexes = useMemo(
    () => options.map((opt, i) => (opt.supportsInstall ? i : -1)).filter((i) => i >= 0),
    [options],
  )

  const [cursor, setCursor] = useState<number>(() => selectableIndexes[0] ?? 0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showSelectHint, setShowSelectHint] = useState(false)
  const [done, setDone] = useState(false)

  useInput((input, key) => {
    if (done) return

    // Dismiss the soft-abort hint on any keypress that isn't the triggering
    // Enter itself — matches §11.5 "Hint persists until next keypress."
    if (showSelectHint) setShowSelectHint(false)

    if (key.escape || (key.ctrl && input === 'c')) {
      setDone(true)
      exit()
      onAbort()
      return
    }

    if (key.upArrow) {
      setCursor((c) => prevSelectable(c, selectableIndexes))
      return
    }
    if (key.downArrow) {
      setCursor((c) => nextSelectable(c, selectableIndexes))
      return
    }

    if (input === ' ') {
      if (!options[cursor]?.supportsInstall) return
      setSelected((prev) => toggle(prev, cursor))
      return
    }

    if (key.return) {
      if (selected.size === 0) {
        setShowSelectHint(true)
        return
      }
      const picked = Array.from(selected)
        .sort((a, b) => a - b)
        .map((i) => options[i])
        .filter((o): o is FirstPartyAdapter => o !== undefined)
      setDone(true)
      exit()
      onConfirm(picked)
    }
  })

  const installedSet = useMemo(() => new Set(installedNames), [installedNames])
  const header =
    installedSet.size === 0
      ? 'No AI tools are connected yet. Pick which adapter to install.'
      : 'Pick which adapter to install or update.'

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text>{header}</Text>
      <Box height={1} />
      {options.map((opt, i) => (
        <PickerRow
          key={opt.name}
          option={opt}
          focused={i === cursor}
          selected={selected.has(i)}
          installed={installedSet.has(opt.name)}
        />
      ))}
      <Box height={1} />
      <Text color={THEME.keyword}>↑↓ move · Space toggle · Enter confirm · Esc cancel</Text>
      {showSelectHint && <Text color={THEME.hint}>Select at least one with Space.</Text>}
    </Box>
  )
}

function PickerRow({
  option,
  focused,
  selected,
  installed,
}: {
  option: FirstPartyAdapter
  focused: boolean
  selected: boolean
  installed: boolean
}) {
  const disabled = !option.supportsInstall
  const cursor = focused && !disabled ? '▸' : ' '
  const marker = selected ? '●' : '○'
  const markerColor = selected ? THEME.secondary : undefined

  if (disabled) {
    return (
      <Text color={THEME.hint}>
        {'  '}
        {marker} {option.name} {option.comingSoonLabel ?? ''}
      </Text>
    )
  }

  if (installed) {
    // Already installed → render in green with a short "select to update" hint.
    return (
      <Box>
        <Text color={THEME.primary}>{cursor}</Text>
        <Text> </Text>
        <Text color={markerColor ?? THEME.secondary}>{marker}</Text>
        <Text color={THEME.secondary}> {option.name}</Text>
        <Text color={THEME.hint}> (installed — select to update)</Text>
      </Box>
    )
  }

  return (
    <Box>
      <Text color={THEME.primary}>{cursor}</Text>
      <Text> </Text>
      <Text color={markerColor}>{marker}</Text>
      <Text> {option.name}</Text>
    </Box>
  )
}

function toggle(prev: Set<number>, i: number): Set<number> {
  const next = new Set(prev)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  return next
}

function nextSelectable(from: number, indexes: number[]): number {
  if (indexes.length === 0) return from
  const currentPos = indexes.indexOf(from)
  if (currentPos === -1) return indexes[0] ?? from
  return indexes[(currentPos + 1) % indexes.length] ?? from
}

function prevSelectable(from: number, indexes: number[]): number {
  if (indexes.length === 0) return from
  const currentPos = indexes.indexOf(from)
  if (currentPos === -1) return indexes[indexes.length - 1] ?? from
  return indexes[(currentPos - 1 + indexes.length) % indexes.length] ?? from
}
