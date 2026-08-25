import type { FacetUpdateSelection, UpdateChoice, UpdatePlanRow } from '@agent-facets/engine'
import { Box, Text, useApp, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { THEME } from '../../tui/theme.ts'
import { choiceAdvances, type UpdateMode } from './selection.ts'

type Candidate = Extract<UpdatePlanRow, { kind: 'candidate' }>

/**
 * A row's displayed choice, tagged by whether taking it would actually
 * move the facet.
 *
 * The tag exists so the selected state below can require an advancing
 * one. Without it, "selected, showing a version equal to what is already
 * installed" is representable, and the picker would happily confirm a
 * selection the engine is obliged to reject.
 */
type DisplayChoice = { kind: 'advancing'; choice: UpdateChoice } | { kind: 'stationary'; choice: UpdateChoice }

/**
 * One row's state.
 *
 * Selection and displayed choice are one value rather than two, because
 * the legal combinations are not a product: a selected row must be
 * showing an advancing choice, while an unselected row may be showing
 * anything. Toggling to a stationary choice therefore *produces* the
 * unselected arm, instead of leaving a boolean behind that disagrees
 * with what is on screen.
 */
type RowState =
  | { kind: 'selected'; displayed: Extract<DisplayChoice, { kind: 'advancing' }> }
  | { kind: 'unselected'; displayed: DisplayChoice }

export interface UpdatePickerProps {
  plan: readonly UpdatePlanRow[]
  /** Which version each row starts on: `--latest` starts on Latest. */
  mode: UpdateMode
  /** Fires once, with at least one advancing selection. */
  onConfirm: (selections: FacetUpdateSelection[]) => void
  /** Fires once when the user abandons the picker (Esc / Ctrl-C). */
  onAbort: () => void
}

/**
 * Choose which facets to update, and which release each one takes.
 *
 * Only candidates appear: a facet with nothing newer has no decision to
 * offer. Both versions stay visible on every row, because the choice
 * this screen exists for — take the range target, or cross the range to
 * the latest release — cannot be made from one of them.
 *
 * Keys follow the adapter picker (↑↓ / Space / Enter / Esc) so the two
 * selection screens in this CLI do not have separate vocabularies, plus
 * `l` for the toggle this one needs.
 */
export function UpdatePicker({ plan, mode, onConfirm, onAbort }: UpdatePickerProps) {
  const { exit } = useApp()
  const candidates = useMemo(() => plan.filter((row): row is Candidate => row.kind === 'candidate'), [plan])

  const [rows, setRows] = useState<RowState[]>(() => candidates.map((row) => initialState(row, mode)))
  const [cursor, setCursor] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const selectedCount = rows.filter((row) => row.kind === 'selected').length

  const finish = (action: () => void) => {
    setDone(true)
    exit()
    action()
  }

  useInput((input, key) => {
    if (done) return
    if (hint !== null) setHint(null)

    if (key.escape || (key.ctrl && input === 'c')) {
      finish(onAbort)
      return
    }

    if (key.upArrow) {
      setCursor((c) => (c === 0 ? candidates.length - 1 : c - 1))
      return
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % candidates.length)
      return
    }

    if (input === ' ') {
      const row = rows[cursor]
      const candidate = candidates[cursor]
      if (row === undefined || candidate === undefined) return
      if (row.kind === 'selected') {
        setRows(replace(rows, cursor, { kind: 'unselected', displayed: row.displayed }))
        return
      }
      if (row.displayed.kind === 'stationary') {
        // Refused rather than silently ignored: the version on screen is
        // the one already installed, and the user pressing Space is
        // asking for something this row cannot do until they toggle.
        setHint(`${candidate.facet.name} ${describeChoice(row.displayed.choice)} is already installed — press l first.`)
        return
      }
      setRows(replace(rows, cursor, { kind: 'selected', displayed: row.displayed }))
      return
    }

    if (input === 'l' || input === 'L') {
      const row = rows[cursor]
      const candidate = candidates[cursor]
      if (row === undefined || candidate === undefined) return
      const flipped = other(row.displayed.choice)
      setRows(replace(rows, cursor, stateFor(candidate, flipped, row.kind === 'selected')))
      return
    }

    if (key.return) {
      const selections: FacetUpdateSelection[] = []
      for (const [index, row] of rows.entries()) {
        const candidate = candidates[index]
        if (row.kind !== 'selected' || candidate === undefined) continue
        selections.push({ facetName: candidate.facet.name, choice: row.displayed.choice })
      }
      if (selections.length === 0) {
        setHint('Select at least one facet with Space, or press Esc to cancel.')
        return
      }
      finish(() => onConfirm(selections))
    }
  })

  const nameWidth = candidates.reduce((max, row) => Math.max(max, row.facet.name.length), 0)

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text>Choose which facets to update.</Text>
      <Box height={1} />
      {candidates.map((candidate, index) => {
        const row = rows[index]
        if (row === undefined) return null
        return (
          <PickerRow
            key={candidate.facet.name}
            candidate={candidate}
            state={row}
            focused={index === cursor}
            nameWidth={nameWidth}
          />
        )
      })}
      <Box height={1} />
      <Text color={THEME.keyword}>↑↓ move · Space toggle · l target/latest · Enter confirm · Esc cancel</Text>
      <Text color={THEME.hint}>
        {selectedCount} of {candidates.length} selected
      </Text>
      {hint !== null && <Text color={THEME.caution}>{hint}</Text>}
    </Box>
  )
}

function PickerRow({
  candidate,
  state,
  focused,
  nameWidth,
}: {
  candidate: Candidate
  state: RowState
  focused: boolean
  nameWidth: number
}) {
  const chosen = state.displayed.choice
  const version = chosen === 'range' ? candidate.facet.target : candidate.facet.latest
  const label = describeChoice(chosen)
  const stationary = state.displayed.kind === 'stationary'

  return (
    <Box>
      <Text color={focused ? THEME.focus : THEME.hint}>{focused ? '▸ ' : '  '}</Text>
      <Text color={state.kind === 'selected' ? THEME.secondary : undefined}>
        {state.kind === 'selected' ? '●' : '○'}
      </Text>
      <Text bold color={THEME.brand}>
        {' '}
        {candidate.facet.name.padEnd(nameWidth)}
      </Text>
      <Text color={THEME.hint}> {describeExact(candidate.facet.current)} → </Text>
      <Text color={stationary ? THEME.hint : THEME.success}>{version.metadata.version}</Text>
      <Text color={THEME.hint}>
        {' '}
        ({label}
        {stationary ? ', unchanged' : ''})
      </Text>
    </Box>
  )
}

function initialState(candidate: Candidate, mode: UpdateMode): RowState {
  // Selected by default when the mode's own choice already advances: the
  // user asked for this mode, so its answer is the one they came for.
  return stateFor(candidate, mode, true)
}

function stateFor(candidate: Candidate, choice: UpdateChoice, select: boolean): RowState {
  const displayed: DisplayChoice = choiceAdvances(candidate, choice)
    ? { kind: 'advancing', choice }
    : { kind: 'stationary', choice }
  if (select && displayed.kind === 'advancing') return { kind: 'selected', displayed }
  return { kind: 'unselected', displayed }
}

function replace(rows: readonly RowState[], index: number, next: RowState): RowState[] {
  return rows.map((row, i) => (i === index ? next : row))
}

function other(choice: UpdateChoice): UpdateChoice {
  return choice === 'range' ? 'latest' : 'range'
}

function describeChoice(choice: UpdateChoice): string {
  return choice === 'range' ? 'target' : 'latest'
}

function describeExact(version: { major: number; minor: number; patch: number }): string {
  return `${version.major}.${version.minor}.${version.patch}`
}
