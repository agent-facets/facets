import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useState } from 'react'
import { THEME } from '../theme.ts'

/**
 * Interactive login flow: a two-row method menu followed by a masked
 * personal-access-token prompt.
 *
 * The component collects input only — it never makes a network call.
 * The caller verifies the submitted token (and re-mounts with an
 * `error` to reprompt on rejection), then persists it. This keeps the
 * registry round-trip in the command/engine layer, not in the view.
 *
 * Menu rows:
 *   - "Paste a personal access token" — active.
 *   - "Sign in via browser" — disabled, dimmed, "(coming soon)". Shown
 *     so the forthcoming browser flow is discoverable; it cannot be
 *     selected (↑↓ skip it, Enter never lands on it).
 *
 * Keyboard:
 *   ↑↓     move (skips the disabled row)
 *   Enter  on the PAT row → advance to the masked prompt
 *   Esc    cancel (hands back null)
 *   In the prompt: Enter submits the token, Esc returns to the menu.
 */

type Phase = 'menu' | 'token'

export interface LoginMenuProps {
  /**
   * When set, an error from a previous token attempt to display above
   * the prompt (the caller re-mounts with this after a rejected token).
   * The component starts directly in the token phase when an error is
   * present, so the user reprompts without re-selecting the method.
   */
  initialError?: string
  /** Fires when the user submits a (non-empty) token. */
  onSubmitToken: (token: string) => void
  /** Fires when the user aborts the whole flow (Esc at the menu). */
  onCancel: () => void
}

export function LoginMenu({ initialError, onSubmitToken, onCancel }: LoginMenuProps) {
  const { exit } = useApp()
  const [phase, setPhase] = useState<Phase>(initialError !== undefined ? 'token' : 'menu')
  const [token, setToken] = useState('')
  const [done, setDone] = useState(false)

  // Menu input. The token phase is driven by <TextInput> (onSubmit), so
  // useInput here only needs to handle the menu and the token-phase Esc.
  useInput((_input, key) => {
    if (done) return

    if (phase === 'menu') {
      if (key.escape) {
        finish(() => onCancel())
        return
      }
      // Only one selectable row, so ↑↓ are no-ops; Enter advances.
      if (key.return) {
        setPhase('token')
        return
      }
      return
    }

    // phase === 'token': Esc returns to the menu (cancel the entry).
    if (key.escape) {
      setToken('')
      setPhase('menu')
    }
  })

  function finish(emit: () => void): void {
    setDone(true)
    exit()
    emit()
  }

  function submitToken(value: string): void {
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    finish(() => onSubmitToken(trimmed))
  }

  if (phase === 'menu') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text>How would you like to sign in?</Text>
        <Box height={1} />
        <Box>
          <Text color={THEME.primary}>▸ </Text>
          <Text color={THEME.secondary}>● </Text>
          <Text>Paste a personal access token</Text>
        </Box>
        <Box>
          <Text>{'  '}</Text>
          <Text color={THEME.hint}>○ Sign in via browser (coming soon)</Text>
        </Box>
        <Box height={1} />
        <Text color={THEME.keyword}>Enter select · Esc cancel</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      {initialError !== undefined ? (
        <>
          <Text color={THEME.warning}>{initialError}</Text>
          <Box height={1} />
        </>
      ) : null}
      <Box gap={1}>
        <Text>Paste your personal access token:</Text>
        <TextInput value={token} onChange={setToken} onSubmit={submitToken} mask="*" />
      </Box>
      <Box height={1} />
      <Text color={THEME.keyword}>Enter submit · Esc back</Text>
    </Box>
  )
}
