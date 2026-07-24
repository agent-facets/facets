import {
  isAdditionItem,
  optionIndexForResolution,
  optionLabelsFor,
  type ReconciliationItem,
  type ReconciliationResolution,
  reconciliationItemKey,
  resolutionForOption,
} from '@agent-facets/engine'
import { Box, Text } from 'ink'
import { useCallback, useEffect, useMemo } from 'react'
import { Button } from '../../components/button.tsx'
import { ReconciliationItemRow } from '../../components/reconciliation-item.tsx'
import { useFocusOrder } from '../../context/focus-order-context.ts'
import { THEME } from '../../theme.ts'
import type { ResolvedItem } from './use-edit-session.ts'

/** Human-readable primary line for a reconciliation item, from structured fields. */
function itemDescription(item: ReconciliationItem): string {
  switch (item.kind) {
    case 'asset-addition':
      return item.path
    case 'asset-missing':
      return `${item.name} (${item.assetType}) — ${item.expectedPath}`
    case 'companion-addition':
      return item.path
    case 'companion-missing':
      return item.expectedPath
    case 'root-addition':
      return item.path
    case 'root-missing':
      return item.path
  }
}

export function ReconciliationView({
  items,
  resolutions,
  onResolve,
  onContinue,
}: {
  items: ReconciliationItem[]
  resolutions: Map<string, ResolvedItem>
  onResolve: (item: ReconciliationItem, resolution: ReconciliationResolution) => void
  onContinue: () => void
}) {
  const { setFocusIds, focusedId, focus } = useFocusOrder()

  const allResolved = items.every((item) => resolutions.has(reconciliationItemKey(item)))

  const additions = items.filter((i) => isAdditionItem(i))
  const missing = items.filter((i) => !isAdditionItem(i))

  const focusIds = useMemo(() => {
    const ids = items.map((item) => `recon-${reconciliationItemKey(item)}`)
    ids.push('recon-continue')
    return ids
  }, [items])

  useEffect(() => {
    setFocusIds(focusIds)
    if (!focusedId) {
      focus(focusIds[0] ?? '')
    }
  }, [focusIds, setFocusIds, focusedId, focus])

  const handleSelect = useCallback(
    (item: ReconciliationItem, optionIndex: number) => {
      const key = reconciliationItemKey(item)
      onResolve(item, resolutionForOption(item, optionIndex))

      // Auto-advance to the next unresolved item.
      const currentIdx = items.findIndex((i) => reconciliationItemKey(i) === key)
      for (let i = currentIdx + 1; i < items.length; i++) {
        const nextItem = items[i]
        if (!nextItem) continue
        const nextKey = reconciliationItemKey(nextItem)
        if (!resolutions.has(nextKey)) {
          focus(`recon-${nextKey}`)
          return
        }
      }
      focus('recon-continue')
    },
    [items, resolutions, onResolve, focus],
  )

  const renderGroup = (label: string, groupItems: ReconciliationItem[]) => {
    if (groupItems.length === 0) return null
    return (
      <Box flexDirection="column" key={label}>
        <Box marginBottom={0}>
          <Text bold color={THEME.warning}>
            {label}
          </Text>
        </Box>
        {groupItems.map((item) => {
          const key = reconciliationItemKey(item)
          const [a, b] = optionLabelsFor(item)
          return (
            <ReconciliationItemRow
              key={key}
              id={`recon-${key}`}
              description={itemDescription(item)}
              options={[{ label: a }, { label: b }]}
              selectedIndex={optionIndexForResolution(item, resolutions.get(key)?.resolution)}
              onSelect={(index) => handleSelect(item, index)}
            />
          )
        })}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold color={THEME.brand}>
        Reconciliation — {items.length} item{items.length !== 1 ? 's' : ''} to resolve
      </Text>

      {renderGroup('New files on disk:', additions)}
      {renderGroup('Missing from disk:', missing)}

      <Box marginTop={1}>
        <Button
          id="recon-continue"
          label="[ Continue to edit ]"
          disabled={!allResolved}
          gradient={allResolved}
          animateGradient={allResolved && focusedId === 'recon-continue'}
          onPress={onContinue}
        />
      </Box>

      <Box>
        <Text dimColor>↑ ↓ navigate · ← → switch option · Enter select · Esc Esc exit</Text>
      </Box>
    </Box>
  )
}
