import { Box, Text, useApp, useInput } from 'ink'
import { useState } from 'react'
import { THEME } from '../theme.ts'

/**
 * One option in the single-select prompt. `label` is the user-visible
 * row; `value` is the discriminator the caller branches on after
 * `onSelect` fires.
 */
export interface SelectOption<T extends string> {
  label: string
  value: T
}

export interface SelectPromptProps<T extends string> {
  /** Optional headline shown above the option list. */
  question?: string
  /** Options to render, top-to-bottom. The first option starts focused. */
  options: ReadonlyArray<SelectOption<T>>
  /** Fires with the selected option's `value` when the user presses Enter. */
  onSelect: (value: T) => void
  /** Fires when the user cancels (Esc / Ctrl-C). */
  onCancel: () => void
}

/**
 * Single-select arrow-key prompt. Mirrors the keyboard contract of the
 * existing multi-select `InstallPicker` but without selection toggle:
 *
 *   ↑↓      move the cursor
 *   Enter   confirm the focused option
 *   Esc /   cancel (caller receives `null`)
 *   Ctrl-C
 *
 * Used by the publish command's identity-drift handler to surface three
 * choices (build new + publish; publish existing; cancel) in a single
 * keystroke each, matching the established Ink-prompt idiom in this
 * codebase rather than chaining two ConfirmPrompts.
 *
 * Generic over the value type so the caller gets discriminated-union
 * typing on the result without re-narrowing.
 */
export function SelectPrompt<T extends string>({ question, options, onSelect, onCancel }: SelectPromptProps<T>) {
  const { exit } = useApp()
  const [cursor, setCursor] = useState(0)
  const [done, setDone] = useState(false)

  useInput((input, key) => {
    if (done) return

    if (key.escape || (key.ctrl && input === 'c')) {
      setDone(true)
      exit()
      onCancel()
      return
    }

    if (key.upArrow) {
      if (options.length === 0) return
      setCursor((c) => (c <= 0 ? options.length - 1 : c - 1))
      return
    }
    if (key.downArrow) {
      if (options.length === 0) return
      setCursor((c) => (c >= options.length - 1 ? 0 : c + 1))
      return
    }

    if (key.return) {
      const picked = options[cursor]
      if (picked === undefined) return
      setDone(true)
      exit()
      onSelect(picked.value)
    }
  })

  return (
    <Box flexDirection="column" paddingY={1}>
      {question !== undefined && (
        <>
          <Text>{question}</Text>
          <Box height={1} />
        </>
      )}
      {options.map((opt, i) => (
        <SelectRow key={opt.value} label={opt.label} focused={i === cursor} />
      ))}
      <Box height={1} />
      <Text color={THEME.keyword}>↑↓ move · Enter confirm · Esc cancel</Text>
    </Box>
  )
}

function SelectRow({ label, focused }: { label: string; focused: boolean }) {
  const cursor = focused ? '▸' : ' '
  return (
    <Box>
      <Text color={THEME.focus}>{cursor}</Text>
      <Text> {label}</Text>
    </Box>
  )
}
