import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useRef, useState } from 'react'
import { THEME } from '../theme.ts'

type Phase = 'menu' | 'token' | 'polling'
type Choice = 'browser' | 'token'

export interface LoginMenuProps {
  initialError?: string
  polling?: boolean
  tokenOnly?: boolean
  onChooseBrowser?: () => void
  onSubmitToken: (token: string) => void
  onCancel: () => void
}

/** Collects a method or token, or handles keys while a device attempt is polling. */
export function LoginMenu({
  initialError,
  polling = false,
  tokenOnly = false,
  onChooseBrowser,
  onSubmitToken,
  onCancel,
}: LoginMenuProps) {
  const { exit } = useApp()
  const [phase, setPhase] = useState<Phase>(
    polling ? 'polling' : tokenOnly || initialError !== undefined ? 'token' : 'menu',
  )
  const [choice, setChoice] = useState<Choice>('browser')
  const [token, setToken] = useState('')
  const settled = useRef(false)

  function finish(emit: () => void): void {
    if (settled.current) return
    settled.current = true
    emit()
    exit()
  }

  useInput((input, key) => {
    if (settled.current) return
    if (key.ctrl && input === 'c') {
      finish(onCancel)
      return
    }
    if (phase === 'polling') {
      if (key.escape) finish(onCancel)
      return
    }
    if (phase === 'menu') {
      if (key.escape) {
        finish(onCancel)
      } else if (key.upArrow || key.downArrow) {
        setChoice((current) => (current === 'browser' ? 'token' : 'browser'))
      } else if (key.return) {
        if (choice === 'browser') finish(() => onChooseBrowser?.())
        else setPhase('token')
      }
      return
    }
    if (key.escape && tokenOnly) {
      finish(onCancel)
    } else if (key.escape) {
      setToken('')
      setPhase('menu')
    }
  })

  function submitToken(value: string): void {
    const trimmed = value.trim()
    if (trimmed.length > 0) finish(() => onSubmitToken(trimmed))
  }

  if (phase === 'polling') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text>Waiting for browser sign-in…</Text>
        <Text color={THEME.keyword}>Esc or Ctrl-C cancel</Text>
      </Box>
    )
  }

  if (phase === 'menu') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text>How would you like to sign in?</Text>
        <Box height={1} />
        <Box>
          <Text color={THEME.focus}>{choice === 'browser' ? '▸ ' : '  '}</Text>
          <Text color={THEME.secondary}>● </Text>
          <Text>Sign in via browser</Text>
        </Box>
        <Box>
          <Text color={THEME.focus}>{choice === 'token' ? '▸ ' : '  '}</Text>
          <Text color={THEME.hint}>○ </Text>
          <Text>Paste a personal access token</Text>
        </Box>
        <Box height={1} />
        <Text color={THEME.keyword}>↑↓ choose · Enter select · Esc cancel</Text>
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
