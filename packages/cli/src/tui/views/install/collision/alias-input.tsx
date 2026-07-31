import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { THEME } from '../../../theme.ts'
import { validateAlias } from './draft.ts'

/**
 * The alias editor for one claimant.
 *
 * Validation runs on every keystroke rather than on Enter. The spec
 * requires the reason to be visible while the alias is invalid, and
 * on-commit validation cannot do that — the user would type a name,
 * press Enter, and only then learn that capitals are illegal.
 *
 * It calls the same published validator the planner uses, so the message
 * shown here is the message the engine would produce. A second,
 * friendlier copy of the grammar would be a second source of truth and
 * would eventually disagree.
 */
export function AliasInput({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (alias: string) => void
  onCancel: () => void
}) {
  const error = value.length === 0 ? 'an alias cannot be empty' : validateAlias(value)

  useInput((_input, key) => {
    if (key.return) {
      // Enter is inert while invalid: refusing here is what stops an
      // unusable name from reaching the draft at all, which is why the
      // draft never has to represent one.
      if (error === null) onSubmit(value)
      return
    }
    if (key.escape) onCancel()
  })

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={THEME.focus}>{'   >'}</Text>
        <TextInput value={value} onChange={onChange} focus />
      </Box>
      {error === null ? (
        <Text color={THEME.hint}>
          {'     '}
          <Text color={THEME.keyword}>Enter</Text> apply · <Text color={THEME.keyword}>Esc</Text> cancel
        </Text>
      ) : (
        <Text color={THEME.warning}>
          {'     '}
          {error}
        </Text>
      )}
    </Box>
  )
}
