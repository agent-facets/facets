import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { THEME } from '../theme.ts'

export function AssetInlineInput({
  value,
  placeholder,
  error,
  isFocused,
  onChange,
  validate,
  onError,
  onSubmit,
  onCancel,
  onDownArrow,
}: {
  id: string
  value: string
  placeholder?: string
  error: string
  isFocused: boolean
  onChange: (value: string) => void
  validate?: (value: string) => string | undefined
  onError: (error: string) => void
  onSubmit: (name: string) => void
  onCancel: () => void
  onDownArrow?: () => void
}) {
  useInput(
    (_input, key) => {
      if (!isFocused) return
      if (key.return) {
        const name = value || placeholder || ''
        if (!name) {
          onCancel()
          return
        }
        if (validate) {
          const err = validate(name)
          if (err) {
            onError(err)
            return
          }
        }
        onSubmit(name)
        return
      }
      if (key.escape) {
        onCancel()
        return
      }
      if (key.downArrow && onDownArrow) {
        onDownArrow()
        return
      }
      if (key.tab && !value && placeholder) {
        onChange(placeholder)
        return
      }
    },
    { isActive: isFocused },
  )

  return (
    <Box marginLeft={2} gap={1}>
      <Text color={THEME.tertiary}>{'>'}</Text>
      <TextInput value={value} onChange={onChange} placeholder={placeholder} focus={isFocused} />
      {error ? (
        <Text color={THEME.warning}>· {error}</Text>
      ) : value ? (
        <Text color={THEME.hint}>
          · <Text color={THEME.keyword}>Enter</Text> save ·{' '}
          {onDownArrow && (
            <>
              <Text color={THEME.keyword}>↓</Text> description ·{' '}
            </>
          )}
          <Text color={THEME.keyword}>Esc</Text> revert
        </Text>
      ) : placeholder ? (
        <Text color={THEME.hint}>
          · <Text color={THEME.keyword}>Tab</Text> to fill · <Text color={THEME.keyword}>Escape</Text> to cancel
        </Text>
      ) : (
        <Text color={THEME.hint}>
          · <Text color={THEME.keyword}>Enter</Text> to add · <Text color={THEME.keyword}>Escape</Text> to cancel
        </Text>
      )}
    </Box>
  )
}
