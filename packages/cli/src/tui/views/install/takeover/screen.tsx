import type { AssetTakeoverDecision, AssetTakeoverRequest } from '@agent-facets/engine'
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { THEME } from '../../../theme.ts'

/**
 * The just-in-time asset takeover screen.
 *
 * Opposite default to the MCP approval screen, for the opposite reason.
 * There the question is whether a command may run at all; here the desired
 * state already authorizes reconciling this identity, and the only news is
 * that this machine did not put the current file there. Continuing is what
 * the user asked for by running the command, so Continue is selected — and
 * a non-interactive run, which never sees this screen, continues too. A
 * default of Cancel would make the two disagree.
 *
 * Reached mid-write, unlike MCP consent: cancelling here rolls back
 * everything the operation has already done, which is why the failure
 * report — not this screen — is what tells the user what state the tree
 * ended in.
 */
export function AssetTakeoverScreen({
  request,
  onComplete,
}: {
  request: AssetTakeoverRequest
  /** Settles the engine's pending resolver call. Called exactly once. */
  onComplete: (decision: AssetTakeoverDecision) => void
}) {
  const [choice, setChoice] = useState<TakeoverChoice>('continue')

  useInput((input, key) => {
    // The engine is mid-journal and awaiting this promise. An interrupt has
    // to settle it — cancelling, which is the answer that triggers the
    // rollback the user implicitly asked for by interrupting.
    if (key.ctrl && input === 'c') {
      onComplete({ kind: 'cancelled' })
      return
    }
    if (key.escape) {
      onComplete({ kind: 'cancelled' })
      return
    }
    if (key.leftArrow || key.rightArrow || key.tab) {
      setChoice((current) => (current === 'continue' ? 'cancel' : 'continue'))
      return
    }
    if (key.return) {
      onComplete(choice === 'continue' ? { kind: 'continue' } : { kind: 'cancelled' })
    }
  })

  const { asset, authoredName, adapter, facet, occupancy } = request
  // An alias is the case where the name on disk is not the name the facet
  // published, so naming only one of them would leave the user unable to
  // find either.
  const naming = authoredName === asset.name ? asset.name : `${authoredName} → ${asset.name}`

  return (
    <Box flexDirection="column">
      <Text bold color={THEME.brand}>
        A file is already at this destination
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text>
          {adapter} <Text color={THEME.hint}>·</Text> {asset.scope} {asset.type} <Text bold>{naming}</Text>
        </Text>
        <Text color={THEME.hint}>wanted by {facet}, and not recorded as installed by this project on this machine</Text>
        <Text color={occupancy === 'equivalent' ? THEME.hint : THEME.caution}>
          {occupancy === 'equivalent'
            ? 'It already matches what would be written, so continuing adopts it without changing the file.'
            : 'It differs from what would be written, so continuing replaces its contents.'}
        </Text>
        <Text color={THEME.hint}>Cancelling undoes everything this command has done so far.</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box>
          {CHOICES.map((option) => (
            <Box key={option} marginRight={2}>
              {/* Marker as well as color: a selection a user cannot see
                  without color is a selection some users cannot see. */}
              <Text color={option === choice ? THEME.focus : THEME.hint} bold={option === choice}>
                {option === choice ? '›' : ' '} {CHOICE_LABELS[option]}
              </Text>
            </Box>
          ))}
        </Box>
        <Text color={THEME.hint}>←/→ choose · enter confirm · esc cancel</Text>
      </Box>
    </Box>
  )
}

const CHOICES = ['continue', 'cancel'] as const
type TakeoverChoice = (typeof CHOICES)[number]

const CHOICE_LABELS: Record<TakeoverChoice, string> = {
  continue: 'Continue',
  cancel: 'Cancel',
}
