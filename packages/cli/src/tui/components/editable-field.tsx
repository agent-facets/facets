import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useCallback, useEffect, useState } from 'react'
import { useFocusMode } from '../context/focus-mode-context.ts'
import { useFocusOrder } from '../context/focus-order-context.ts'
import type { RequiredFieldKey } from '../context/form-state-context.ts'
import { useFormState } from '../context/form-state-context.ts'
import { THEME } from '../theme.ts'

export function EditableField({
  field,
  label,
  placeholder,
  hint,
  defaultValue,
  dimmed,
  validate,
  onConfirm,
}: {
  field: RequiredFieldKey
  label: string
  placeholder?: string
  hint?: string
  defaultValue?: string
  dimmed?: boolean
  validate?: (value: string) => string | undefined
  onConfirm?: () => void
}) {
  const id = `field-${field}`
  const { focusedId } = useFocusOrder()
  const { mode, setMode } = useFocusMode()
  const { form, setFieldValue, setFieldStatus } = useFormState()
  const { value, status } = form.fields[field]
  const isFocused = focusedId === id
  const editing = status === 'editing'
  const [error, setError] = useState('')
  const [didAutofill, setDidAutofill] = useState(false)
  const [previousValue, setPreviousValue] = useState<string | undefined>(undefined)

  const startEditing = useCallback(() => {
    setPreviousValue(value || undefined)
    setFieldStatus(field, 'editing')
    // Revising an existing value: Escape reverts without triggering exit modal
    // Initial entry: Escape passes through to the exit hook
    setMode(value ? 'field-revision' : 'field-initial-entry')
  }, [field, value, setFieldStatus, setMode])

  const stopEditing = useCallback(() => {
    setPreviousValue(undefined)
    setFieldStatus(field, value ? 'confirmed' : 'empty')
    setMode('form-navigation')
  }, [field, value, setFieldStatus, setMode])

  const cancelEditing = useCallback(() => {
    if (previousValue) {
      setFieldValue(field, previousValue)
      setPreviousValue(undefined)
      setFieldStatus(field, 'confirmed')
      setMode('form-navigation')
      setError('')
    }
  }, [previousValue, field, setFieldValue, setFieldStatus, setMode])

  // Handle Enter to edit, or 'c' to clear and edit
  useInput(
    (input, key) => {
      if (!editing) {
        if (key.return) {
          startEditing()
        }
        if (input === 'c' && value) {
          setFieldValue(field, '')
          startEditing()
        }
      }
    },
    { isActive: isFocused && !editing && mode === 'form-navigation' },
  )

  // Handle Enter to confirm / Escape to revert (if previously had value)
  useInput(
    (_input, key) => {
      if (key.return) {
        if (validate) {
          const err = validate(value)
          if (err) {
            setError(err)
            return
          }
        }
        if (!value) {
          setError(`${label} is required`)
          return
        }
        setError('')
        stopEditing()
        onConfirm?.()
      }
      if (key.escape && previousValue) {
        cancelEditing()
      }
    },
    { isActive: isFocused && editing },
  )

  // Auto-start editing when focused on an empty required field
  useEffect(() => {
    if (isFocused && !value && !editing && mode === 'form-navigation') {
      startEditing()
    }
  }, [isFocused, value, editing, mode, startEditing])

  // Autofill defaultValue when editing starts on an empty field
  useEffect(() => {
    if (editing && !value && defaultValue && !didAutofill) {
      setFieldValue(field, defaultValue)
      setDidAutofill(true)
    }
  }, [editing, value, defaultValue, didAutofill, field, setFieldValue])

  const isEditing = editing && isFocused

  return (
    <Box flexDirection="column" gap={0}>
      <Box gap={1} marginLeft={2}>
        <Text color={isFocused ? THEME.focus : undefined} bold={isFocused} dimColor={dimmed && !isFocused}>
          {label}:
        </Text>
        {isEditing && error ? (
          <Text color={THEME.warning}>{error}</Text>
        ) : isEditing ? (
          <>
            {hint && <Text color={THEME.hint}>({hint})</Text>}
            {previousValue && (
              <Text color={THEME.hint}>
                <Text color={THEME.keyword}>Escape</Text> to revert to{' '}
                <Text color={THEME.keyword}>"{previousValue}"</Text>
              </Text>
            )}
          </>
        ) : !isEditing && value ? (
          <Text color={dimmed && !isFocused ? undefined : THEME.success} dimColor={dimmed && !isFocused}>
            ✓
          </Text>
        ) : !isEditing ? (
          <Text dimColor>(not set)</Text>
        ) : null}
      </Box>
      <Box>
        {isFocused ? (
          <Text color={THEME.focus} bold>
            {'▸ '}
          </Text>
        ) : (
          <Text>{'  '}</Text>
        )}
        <Box gap={1} marginLeft={2}>
          {isEditing ? (
            <Box gap={1}>
              <Text color={THEME.tertiary}>{'> '}</Text>
              <TextInput value={value} onChange={(v) => setFieldValue(field, v)} placeholder={placeholder} focus />
              <Text color={THEME.hint}>
                · <Text color={THEME.keyword}>Enter</Text> to save
              </Text>
            </Box>
          ) : (
            <Box gap={1}>
              <Text dimColor={dimmed && !isFocused}>{value || ' '}</Text>
              {isFocused && value && (
                <Text color={THEME.hint}>
                  · <Text color={THEME.keyword}>Enter</Text> to edit · <Text color={THEME.keyword}>c</Text> to clear and
                  edit
                </Text>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}
