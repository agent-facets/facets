import { Box, Text } from 'ink'
import { THEME } from '../../../theme.ts'
import { COLLISION_STATUS, type CollisionStatus, describeStatus } from '../collision-status.ts'
import { AliasInput } from './alias-input.tsx'
import type { ClaimantModel } from './draft.ts'

/**
 * The three resolutions, in the order they appear on screen.
 *
 * Ordered Keep → Alias → Omit deliberately: least to most destructive,
 * so arrowing rightwards never skips past a milder option, and the
 * default (Keep) sits where the cursor starts.
 */
export const CHOICES = ['keep', 'alias', 'omit'] as const
export type ChoiceKind = (typeof CHOICES)[number]

const CHOICE_LABELS: Record<ChoiceKind, string> = {
  keep: 'Keep',
  alias: 'Alias',
  omit: 'Omit',
}

/** Which control a claimant's current disposition corresponds to. */
export function choiceOf(claimant: ClaimantModel): ChoiceKind {
  switch (claimant.disposition.kind) {
    case 'authored':
      return 'keep'
    case 'aliased':
      return 'alias'
    case 'omitted':
      return 'omit'
  }
}

/**
 * One status tag, for a claimant or for a whole group.
 *
 * Takes the status rather than a claimant so the group overview can use it
 * too; the two views previously had near-identical private copies, which is
 * one edit away from a fourth state rendering differently in each. The text
 * comes from `describeStatus`, so what the accessibility tests assert is
 * literally what users read.
 */
export function StatusTag({ status }: { status: CollisionStatus }) {
  return <Text color={COLLISION_STATUS[status].color}>{describeStatus(status)}</Text>
}

/** How this claimant's asset will land on disk, in one phrase. */
function outcomeOf(claimant: ClaimantModel): string {
  if (claimant.effectiveName === null) return 'not materialized'
  if (claimant.effectiveName === claimant.authoredName) return claimant.authoredName
  return `${claimant.authoredName} → ${claimant.effectiveName}`
}

export function ClaimantRow({
  claimant,
  focused,
  highlight,
  editing,
  aliasValue,
  onAliasChange,
  onAliasSubmit,
  onAliasCancel,
}: {
  claimant: ClaimantModel
  focused: boolean
  /**
   * The option the arrow keys are currently sitting on, for the focused
   * row only. Separate from the applied choice because moving across the
   * options must not change anything: landing on Alias would otherwise
   * open the editor, and the editor would swallow the next arrow key —
   * making Omit unreachable from Keep.
   */
  highlight: ChoiceKind | null
  editing: boolean
  aliasValue: string
  onAliasChange: (value: string) => void
  onAliasSubmit: (alias: string) => void
  onAliasCancel: () => void
}) {
  const applied = choiceOf(claimant)

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={focused ? THEME.focus : THEME.hint}>{focused ? '▸ ' : '  '}</Text>
        <Text bold>{claimant.facet}</Text>
        <Text color={THEME.hint}>
          {' '}
          {claimant.scope} {claimant.type} {claimant.authoredName}
        </Text>
      </Text>

      <Box marginLeft={4} gap={1}>
        {CHOICES.map((choice) => (
          <Text
            key={choice}
            color={choice === highlight ? THEME.focus : choice === applied ? THEME.success : THEME.hint}
            bold={choice === applied || choice === highlight}
            dimColor={choice !== applied && choice !== highlight}
          >
            {choice === applied ? `(${CHOICE_LABELS[choice]})` : ` ${CHOICE_LABELS[choice]} `}
          </Text>
        ))}
        <StatusTag status={claimant.status} />
      </Box>

      {editing ? (
        <AliasInput value={aliasValue} onChange={onAliasChange} onSubmit={onAliasSubmit} onCancel={onAliasCancel} />
      ) : (
        <Text color={THEME.hint}>
          {'    '}
          {outcomeOf(claimant)}
          {claimant.aliasError !== null && <Text color={THEME.warning}> · {claimant.aliasError}</Text>}
        </Text>
      )}
    </Box>
  )
}
