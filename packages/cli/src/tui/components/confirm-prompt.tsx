import { Box, Text, useApp, useInput } from 'ink'
import { useState } from 'react'
import { THEME } from '../theme.ts'

export interface ConfirmPromptProps {
  /** Question shown to the user. */
  question: string
  /**
   * Default answer when the user presses Enter without typing y/n.
   * Defaults to `false` to match the conventional `(y/N)` shape.
   */
  defaultAnswer?: boolean
  /** Fires once with the user's choice. */
  onAnswer: (answer: boolean) => void
}

/**
 * Single-key y/n prompt that renders inline through Ink. Replaces the
 * older `node:readline` flow, which left stdin in a state Ink couldn't
 * reattach to on subsequent mounts (the "blank screen with no focus"
 * symptom in the create-overwrite path).
 *
 * Key bindings:
 *   - `y` / `Y` → confirm
 *   - `n` / `N` → cancel
 *   - Enter    → use `defaultAnswer`
 *   - Esc / Ctrl-C → cancel
 */
export function ConfirmPrompt({ question, defaultAnswer = false, onAnswer }: ConfirmPromptProps) {
  const { exit } = useApp()
  const [done, setDone] = useState(false)

  useInput((input, key) => {
    if (done) return

    if (key.escape || (key.ctrl && input === 'c')) {
      setDone(true)
      exit()
      onAnswer(false)
      return
    }

    if (key.return) {
      setDone(true)
      exit()
      onAnswer(defaultAnswer)
      return
    }

    if (input === 'y' || input === 'Y') {
      setDone(true)
      exit()
      onAnswer(true)
      return
    }

    if (input === 'n' || input === 'N') {
      setDone(true)
      exit()
      onAnswer(false)
      return
    }
  })

  const hint = defaultAnswer ? '(Y/n)' : '(y/N)'

  return (
    <Box gap={1}>
      <Text>{question}</Text>
      <Text color={THEME.hint}>{hint}</Text>
    </Box>
  )
}
