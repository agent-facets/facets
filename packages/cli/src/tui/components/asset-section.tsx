import { Box, Text } from 'ink'
import { useState } from 'react'
import { useFocusMode } from '../context/focus-mode-context.ts'
import { useFocusOrder } from '../context/focus-order-context.ts'
import type { AssetSectionKey } from '../context/form-state-context.ts'
import { useFormState } from '../context/form-state-context.ts'
import { AssetDescription, truncateDescription } from './asset-description.tsx'
import type { AssetField } from './asset-field-picker.tsx'
import { AssetFieldPicker } from './asset-field-picker.tsx'
import { AssetInlineInput } from './asset-inline-input.tsx'
import { AssetItem } from './asset-item.tsx'
import { Button } from './button.tsx'

export function AssetSection({
  section,
  label,
  defaultName,
  dimmed,
  validate,
  onEditDescription,
}: {
  section: AssetSectionKey
  label: string
  defaultName?: string
  dimmed?: boolean
  validate?: (value: string) => string | undefined
  onEditDescription?: (section: AssetSectionKey, name: string) => void
}) {
  const { form, addAsset, removeAsset, renameAsset, setAssetAdding, setAssetEditing } = useFormState()
  const { items, descriptions, editing, adding } = form.assets[section]
  const { setMode } = useFocusMode()
  const { focusedId, focus } = useFocusOrder()
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState('')
  const [selectedItem, setSelectedItem] = useState<string | null>(null)

  const startAdding = () => {
    setAssetAdding(section, true)
    setInputValue('')
    setError('')
    setMode('field-revision')
  }

  const startEditing = (name: string) => {
    setAssetEditing(section, name)
    setInputValue(name)
    setError('')
    setMode('field-revision')
  }

  const closeInput = (focusTarget?: string | false) => {
    setAssetAdding(section, false)
    setAssetEditing(section, undefined)
    setInputValue('')
    setError('')
    if (focusTarget !== false) {
      setMode('form-navigation')
      focus(focusTarget ?? `add-${section}`)
    }
  }

  const handleFieldChoice = (name: string, field: AssetField) => {
    setSelectedItem(null)
    if (field === 'name') {
      startEditing(name)
    } else {
      onEditDescription?.(section, name)
    }
  }

  const handleRemove = (name: string) => {
    const index = items.indexOf(name)
    removeAsset(section, name)

    if (index < items.length - 1) {
      focus(`item-${section}-${index}`)
    } else if (index > 0) {
      focus(`item-${section}-${index - 1}`)
    } else {
      focus(`add-${section}`)
    }
  }

  return (
    <Box flexDirection="column" gap={0}>
      <Box gap={1}>
        <Text bold dimColor={dimmed}>
          {label}
        </Text>
        {items.length === 0 && !adding && <Text dimColor>(none)</Text>}
      </Box>

      {items.map((item, i) => {
        const itemId = `item-${section}-${i}`
        const isFocusedItem = focusedId === itemId
        const description = descriptions[item] ?? `A ${item} ${section}`

        // Field picker (entered via ↓ during name editing)
        if (selectedItem === item) {
          return (
            <AssetFieldPicker
              key={itemId}
              name={item}
              description={truncateDescription(description)}
              initialField="description"
              onChoose={(field) => handleFieldChoice(item, field)}
              onCancel={() => {
                setSelectedItem(null)
                setMode('form-navigation')
                focus(itemId)
              }}
            />
          )
        }

        // Inline name editing
        if (editing === item) {
          return (
            <Box key={itemId} flexDirection="column">
              <AssetInlineInput
                id={itemId}
                value={inputValue}
                placeholder={item}
                error={error}
                isFocused={isFocusedItem}
                onChange={setInputValue}
                validate={validate}
                onError={setError}
                onSubmit={(newName) => {
                  renameAsset(section, item, newName)
                  closeInput(itemId)
                }}
                onCancel={() => closeInput(itemId)}
                onDownArrow={() => {
                  closeInput(false)
                  setSelectedItem(item)
                }}
              />
              <AssetDescription description={description} />
            </Box>
          )
        }

        // Normal display (level 1)
        return (
          <Box key={itemId} flexDirection="column">
            <AssetItem
              id={itemId}
              name={item}
              isFocused={isFocusedItem}
              onEdit={() => startEditing(item)}
              onRemove={() => handleRemove(item)}
            />
            <AssetDescription description={description} />
          </Box>
        )
      })}

      {adding ? (
        <AssetInlineInput
          id={`add-${section}`}
          value={inputValue}
          placeholder={defaultName}
          error={error}
          isFocused={focusedId === `add-${section}`}
          onChange={setInputValue}
          validate={validate}
          onError={setError}
          onSubmit={(name) => {
            addAsset(section, name)
            closeInput()
          }}
          onCancel={closeInput}
        />
      ) : (
        <Box marginLeft={2}>
          <Button
            id={`add-${section}`}
            label="+ Add"
            hint={
              <Text dimColor>
                <Text>Enter</Text> to add
              </Text>
            }
            onPress={startAdding}
          />
        </Box>
      )}
    </Box>
  )
}
