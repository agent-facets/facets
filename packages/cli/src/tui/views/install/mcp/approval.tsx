import type { McpConsentDecision, McpConsentRequest } from '@agent-facets/engine'
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import {
  consentRequestCounts,
  describeApprovalHeading,
  describeDeclarationInFull,
  describeTakeoverHeading,
} from '../../../../util/mcp-report.ts'
import { THEME } from '../../../theme.ts'

/**
 * The MCP configuration approval screen.
 *
 * What is being authorized is execution: every line under a declaration is
 * a command this machine will hand to a tool to run, or an endpoint it will
 * connect to. So the whole declaration is shown, unelided, and the answer
 * defaults to declining. A default of Approve would let a stray Enter — the
 * key a user is already pressing their way through an install with —
 * authorize a command they never read.
 *
 * The set is answered as a whole. Per-server approval would imply the
 * install can proceed with some servers approved and others not, which is
 * not a state the pipeline has: the plan is composed before this screen
 * opens and is not re-planned after it.
 *
 * Deliberately absent: asset collisions and asset takeovers. Approving a
 * command says nothing about overwriting a file, and those keep their own
 * screens.
 */
export function McpApprovalScreen({
  request,
  onComplete,
}: {
  request: McpConsentRequest
  /** Settles the engine's pending resolver call. Called exactly once. */
  onComplete: (decision: McpConsentDecision) => void
}) {
  const [choice, setChoice] = useState<ApprovalChoice>('decline')
  const counts = consentRequestCounts(request)

  useInput((input, key) => {
    // The engine is holding the project lock on this promise, so an
    // interrupt has to settle it rather than kill the render. Declining is
    // the only safe reading of an interrupt: it is the answer that mutates
    // nothing.
    if (key.ctrl && input === 'c') {
      onComplete({ kind: 'declined' })
      return
    }
    if (key.escape) {
      onComplete({ kind: 'declined' })
      return
    }
    if (key.leftArrow || key.rightArrow || key.tab) {
      setChoice((current) => (current === 'decline' ? 'approve' : 'decline'))
      return
    }
    if (key.return) {
      onComplete(choice === 'approve' ? { kind: 'approved' } : { kind: 'declined' })
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold color={THEME.brand}>
        MCP server configuration needs your approval
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text color={THEME.hint}>
          Approving lets your coding tools launch these commands or connect to these URLs. Facets does not run or
          authenticate to them.
        </Text>
      </Box>

      {counts.declarations > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Servers to configure <Text color={THEME.hint}>({counts.declarations})</Text>
          </Text>
          <Box flexDirection="column" marginLeft={2}>
            {request.declarations.map((entry) => (
              <Box flexDirection="column" key={entry.identity.effectiveName}>
                <Text color={THEME.caution}>{describeApprovalHeading(entry)}</Text>
                <Box flexDirection="column" marginLeft={2}>
                  {describeDeclarationInFull(entry.declaration).map((line) => (
                    <Text key={line}>{line}</Text>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Its own section because it is a different question. The declarations
          above are "may this run at all"; these are "may we take over an
          entry you already had". A user can want one and not the other, and
          collapsing them would hide the second inside the first. */}
      {counts.takeovers > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Existing entries this would take over <Text color={THEME.hint}>({counts.takeovers})</Text>
          </Text>
          <Box flexDirection="column" marginLeft={2}>
            {request.takeovers.map((entry) => (
              <Box flexDirection="column" key={`${entry.adapter}\u0000${entry.identity.effectiveName}`}>
                <Text color={THEME.caution}>{describeTakeoverHeading(entry)}</Text>
                <Box flexDirection="column" marginLeft={2}>
                  {describeDeclarationInFull(entry.declaration).map((line) => (
                    <Text key={line}>{line}</Text>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Box>
          {CHOICES.map((option) => (
            <Box key={option} marginRight={2}>
              {/* The marker, not just the color, carries the selection: a
                  status a user cannot see without color is a status some
                  users cannot see. */}
              <Text color={option === choice ? THEME.focus : THEME.hint} bold={option === choice}>
                {option === choice ? '›' : ' '} {CHOICE_LABELS[option]}
              </Text>
            </Box>
          ))}
        </Box>
        <Text color={THEME.hint}>←/→ choose · enter confirm · esc decline</Text>
      </Box>
    </Box>
  )
}

const CHOICES = ['decline', 'approve'] as const
type ApprovalChoice = (typeof CHOICES)[number]

const CHOICE_LABELS: Record<ApprovalChoice, string> = {
  decline: 'Decline',
  approve: 'Approve all',
}
