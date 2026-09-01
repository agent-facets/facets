import type { NonEmptyArray } from '@agent-facets/common'
import { isNonEmpty } from '@agent-facets/common'
import {
  advancingChoice,
  displayedVersion,
  type ExactVersion,
  type FacetUpdateSelection,
  type UpdateChoice,
} from '@agent-facets/engine'
import { Box, Text, useApp, useInput } from 'ink'
import { useState } from 'react'
import { THEME } from '../../tui/theme.ts'
import { COLUMN_GAP, COLUMN_HEADERS, columnWidth } from '../../tui/views/update/columns.ts'
import { formatExactVersion, versionCellStyle } from '../../tui/views/update/version-change.ts'
import type { UpdateCandidate } from './selection.ts'

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
  /**
   * The rows to choose between — candidates only, and at least one.
   *
   * Pre-filtered and non-empty by type rather than by the caller
   * remembering to check. An empty list would make the cursor arithmetic
   * below divide by zero and leave Enter permanently refusing, and
   * "there is nothing to choose between" is a message the command owns,
   * not a state this screen should be able to render.
   */
  candidates: NonEmptyArray<UpdateCandidate>
  /** Fires once, with at least one advancing selection. */
  onConfirm: (selections: NonEmptyArray<FacetUpdateSelection>) => void
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
 * Every row opens on Latest and unselected, so the screen starts as a
 * list of the newest release each facet could take and Space is the one
 * key that says "yes, this one" — rather than starting with a set of
 * answers already given, where Space means "no, not this one". `--latest`
 * therefore changes nothing here: it is a non-interactive mode's way of
 * saying what this screen already offers on every row.
 *
 * Keys follow the adapter picker (↑↓ / Space / Enter / Esc) so the two
 * selection screens in this CLI do not have separate vocabularies, plus
 * `l` for the toggle this one needs.
 */
export function UpdatePicker({ candidates, onConfirm, onAbort }: UpdatePickerProps) {
  const { exit } = useApp()

  const [rows, setRows] = useState<RowState[]>(() => candidates.map((row) => initialState(row)))
  const [cursor, setCursor] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const selectedCount = rows.filter((row) => row.kind === 'selected').length

  const finish = (action: () => void) => {
    setDone(true)
    exit()
    action()
  }

  /**
   * Put the focused row on a specific column.
   *
   * Absolute rather than relative, so left and right can clamp: asking for the
   * column you are already on is a no-op instead of a bounce back to the
   * other one. Selection is carried through `stateFor`, which drops it
   * when the requested column is not an advancing one — a selected row
   * showing the installed version is not a state this picker can hold.
   */
  const chooseColumn = (choice: UpdateChoice) => {
    const row = rows[cursor]
    const candidate = candidates[cursor]
    if (row === undefined || candidate === undefined) return
    if (row.displayed.choice === choice) return
    setRows(replace(rows, cursor, stateFor(candidate, choice, row.kind === 'selected')))
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

    // Left/right address the two columns directly: left is target,
    // right is latest, and each is where it sits on screen. They clamp
    // rather than wrap, so holding one down settles on a column instead
    // of oscillating between them. `l` stays as the flip for anyone who
    // learned it, and for a keyboard where the arrows are awkward.
    if (key.leftArrow) {
      chooseColumn('range')
      return
    }
    if (key.rightArrow) {
      chooseColumn('latest')
      return
    }

    if (input === 'l' || input === 'L') {
      const row = rows[cursor]
      if (row === undefined) return
      chooseColumn(other(row.displayed.choice))
      return
    }

    if (key.return) {
      const selections: FacetUpdateSelection[] = []
      for (const [index, row] of rows.entries()) {
        const candidate = candidates[index]
        if (row.kind !== 'selected' || candidate === undefined) continue
        selections.push({ facetName: candidate.facet.name, choice: row.displayed.choice })
      }
      if (!isNonEmpty(selections)) {
        setHint('Select at least one facet with Space, or press Esc to cancel.')
        return
      }
      finish(() => onConfirm(selections))
    }
  })

  const widths = columnWidths(candidates)

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text>Choose which facets to update.</Text>
      <Box height={1} />
      <Text color={THEME.hint}>
        {ROW_INDENT}
        {COLUMN_HEADERS.facet.padEnd(widths.name)}
        {COLUMN_GAP}
        {COLUMN_HEADERS.current.padEnd(widths.current)}
        {COLUMN_GAP}
        {COLUMN_HEADERS.target.padEnd(widths.target)}
        {COLUMN_GAP}
        {COLUMN_HEADERS.latest}
      </Text>
      {candidates.map((candidate, index) => {
        const row = rows[index]
        if (row === undefined) return null
        return (
          <PickerRow
            key={candidate.facet.name}
            candidate={candidate}
            state={row}
            focused={index === cursor}
            widths={widths}
          />
        )
      })}
      <Box height={1} />
      {/* Filled triangles rather than line arrows: `←→` jammed together
          smears into one glyph in most terminal fonts, and these read
          cleanly at any weight. They live on the legend line, never in a
          column, so their ambiguous character width cannot pull the
          version table out of alignment. */}
      <Text color={THEME.keyword}>↑↓ move · ◀ ▶ target/latest · Space select · Enter confirm · Esc cancel</Text>
      <Text color={THEME.hint}>
        {selectedCount} of {candidates.length} selected
      </Text>
      {hint !== null && <Text color={THEME.caution}>{hint}</Text>}
    </Box>
  )
}

/** Clears the focus marker and the selection dot, so the header lines up. */
const ROW_INDENT = '    '

interface ColumnWidths {
  name: number
  current: number
  target: number
}

function columnWidths(candidates: readonly UpdateCandidate[]): ColumnWidths {
  return {
    name: columnWidth(
      COLUMN_HEADERS.facet,
      candidates.map((candidate) => candidate.facet.name),
    ),
    current: columnWidth(
      COLUMN_HEADERS.current,
      candidates.map((candidate) => formatExactVersion(candidate.facet.current)),
    ),
    target: columnWidth(
      COLUMN_HEADERS.target,
      candidates.map((candidate) => formatExactVersion(displayedVersion(candidate.facet, 'range'))),
    ),
  }
}

/**
 * One facet's row: what is installed, and both versions it could take.
 *
 * Target and Latest are both always on screen. The choice this screen
 * exists for cannot be made from one of them — "is the release my range
 * forbids worth crossing the range for?" is a comparison, and hiding
 * either side turns it into a guess.
 */
function PickerRow({
  candidate,
  state,
  focused,
  widths,
}: {
  candidate: UpdateCandidate
  state: RowState
  focused: boolean
  widths: ColumnWidths
}) {
  const chosen = state.displayed.choice
  const current = candidate.facet.current

  return (
    <Box>
      <Text color={focused ? THEME.focus : THEME.hint}>{focused ? '▸ ' : '  '}</Text>
      <Text color={state.kind === 'selected' ? THEME.secondary : undefined}>
        {state.kind === 'selected' ? '●' : '○'}
      </Text>
      <Text bold color={THEME.brand}>
        {' '}
        {candidate.facet.name.padEnd(widths.name)}
      </Text>
      <Text color={THEME.hint}>
        {COLUMN_GAP}
        {formatExactVersion(current).padEnd(widths.current)}
        {COLUMN_GAP}
      </Text>
      <VersionCell
        current={current}
        version={displayedVersion(candidate.facet, 'range')}
        chosen={chosen === 'range'}
        pad={widths.target}
      />
      <Text>{COLUMN_GAP}</Text>
      <VersionCell
        current={current}
        version={displayedVersion(candidate.facet, 'latest')}
        chosen={chosen === 'latest'}
      />
      {/* The chosen column, in words. Bold and underline say the same
          thing, but only where the terminal supports them — under
          NO_COLOR, a dumb pipe, or a screen reader they are simply
          absent, and "which of these two is selected" is not a question
          the user can be left to infer from two similar numbers. */}
      <Text color={THEME.hint}>
        {COLUMN_GAP}({describeChoice(chosen)})
      </Text>
    </Box>
  )
}

/**
 * One of the two versions a row can take.
 *
 * Two independent things are encoded, and neither may depend on the
 * other. Which cell the row would install is carried by underline —
 * readable with no colour at all, which is what a colour-blind reader
 * and a `NO_COLOR` terminal both get. How big the jump is, is carried by
 * colour on only the digits that actually move.
 */
function VersionCell({
  current,
  version,
  chosen,
  pad,
}: {
  current: ExactVersion
  version: ExactVersion
  chosen: boolean
  pad?: number
}) {
  const style = versionCellStyle({ current, version, chosen, ...(pad === undefined ? {} : { pad }) })

  return (
    <Text>
      {/* The underline covers the version and nothing else; the padding
          sits outside it. */}
      <Text underline={style.underline}>
        <Text color={THEME.hint}>{style.prefix}</Text>
        {style.changed.length > 0 && (
          <Text bold={style.bold} color={style.changedColor}>
            {style.changed}
          </Text>
        )}
        <Text color={THEME.hint}>{style.rest}</Text>
      </Text>
      {style.padding}
    </Text>
  )
}

function initialState(candidate: UpdateCandidate): RowState {
  // Latest, and nothing selected. Every row is a question this screen was
  // opened to ask, so none of them starts with an answer already filled
  // in; Space is what says yes. Latest is the column it says yes TO,
  // because a user who wanted the range's own answer for everything did
  // not need this screen at all — plain `facet update` is that run.
  //
  // A candidate guarantees that SOME column advances, not that Latest
  // does. On the rare row where it does not — a registry answer that
  // moved backwards — this opens on a stationary Latest that Space
  // refuses by name, and `l` moves to the Target that does advance.
  return stateFor(candidate, 'latest', false)
}

function stateFor(candidate: UpdateCandidate, choice: UpdateChoice, select: boolean): RowState {
  // The engine's predicate, not a comparison of our own: a row this
  // screen lets the user select is exactly a row application accepts.
  const displayed: DisplayChoice =
    advancingChoice(candidate.facet, choice) !== undefined
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

/** The chosen column's name, matching its printed header. */
function describeChoice(choice: UpdateChoice): string {
  return choice === 'range' ? COLUMN_HEADERS.target : COLUMN_HEADERS.latest
}
