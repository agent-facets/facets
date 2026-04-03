import { Box, Text } from 'ink'
import { useCallback, useEffect, useMemo } from 'react'
import { Button } from '../../components/button.tsx'
import { ReconciliationItemRow } from '../../components/reconciliation-item.tsx'
import { useFocusOrder } from '../../context/focus-order-context.ts'
import { THEME } from '../../theme.ts'
import type { ReconciliationItem, ReconciliationResolution } from './edit-types.ts'

/** Maps a reconciliation item to a unique key. */
function itemKey(item: ReconciliationItem): string {
  return `${item.kind}:${item.type}:${item.name}`
}

/** Returns the two action options for a reconciliation item kind. */
function optionsForKind(kind: ReconciliationItem['kind']): [{ label: string }, { label: string }] {
  switch (kind) {
    case 'addition':
      return [{ label: 'Add to manifest' }, { label: 'Ignore for now' }]
    case 'missing':
      return [{ label: 'Scaffold template' }, { label: 'Remove from manifest' }]
    case 'front-matter':
      return [{ label: 'Strip front matter' }, { label: 'Remove from manifest' }]
  }
}

/** Converts a selected option index to a resolution for the given item kind. */
function indexToResolution(kind: ReconciliationItem['kind'], index: number): ReconciliationResolution {
  switch (kind) {
    case 'addition':
      return index === 0 ? { action: 'add-to-manifest' } : { action: 'ignore' }
    case 'missing':
      return index === 0 ? { action: 'scaffold-template' } : { action: 'remove-from-manifest' }
    case 'front-matter':
      return index === 0 ? { action: 'strip-front-matter' } : { action: 'remove-from-manifest' }
  }
}

/** Returns the selected option index for a resolution, or null. */
function resolutionToIndex(
  kind: ReconciliationItem['kind'],
  resolution: ReconciliationResolution | undefined,
): number | null {
  if (!resolution) return null
  switch (kind) {
    case 'addition':
      return resolution.action === 'add-to-manifest' ? 0 : resolution.action === 'ignore' ? 1 : null
    case 'missing':
      return resolution.action === 'scaffold-template' ? 0 : resolution.action === 'remove-from-manifest' ? 1 : null
    case 'front-matter':
      return resolution.action === 'strip-front-matter' ? 0 : resolution.action === 'remove-from-manifest' ? 1 : null
  }
}

export function ReconciliationView({
  items,
  resolutions,
  onResolve,
  onContinue,
}: {
  items: ReconciliationItem[]
  resolutions: Map<string, ReconciliationResolution>
  onResolve: (key: string, resolution: ReconciliationResolution) => void
  onContinue: () => void
}) {
  const { setFocusIds, focusedId, focus } = useFocusOrder()

  const allResolved = items.every((item) => resolutions.has(itemKey(item)))

  // Group items by kind
  const additions = items.filter((i) => i.kind === 'addition')
  const missing = items.filter((i) => i.kind === 'missing')
  const frontMatter = items.filter((i) => i.kind === 'front-matter')

  // Build focus order: all items then continue button
  const focusIds = useMemo(() => {
    const ids = items.map((item) => `recon-${itemKey(item)}`)
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
      const key = itemKey(item)
      const resolution = indexToResolution(item.kind, optionIndex)
      onResolve(key, resolution)

      // Auto-advance to next unresolved item
      const currentIdx = items.findIndex((i) => itemKey(i) === key)
      for (let i = currentIdx + 1; i < items.length; i++) {
        const nextItem = items[i]
        if (!nextItem) continue
        const nextKey = itemKey(nextItem)
        if (!resolutions.has(nextKey)) {
          focus(`recon-${nextKey}`)
          return
        }
      }
      // All resolved — focus continue button
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
          const key = itemKey(item)
          const description =
            item.kind === 'missing'
              ? `${item.name} (${item.type}) — ${item.expectedPath}`
              : 'path' in item
                ? item.path
                : ''

          return (
            <ReconciliationItemRow
              key={key}
              id={`recon-${key}`}
              description={description}
              options={optionsForKind(item.kind)}
              selectedIndex={resolutionToIndex(item.kind, resolutions.get(key))}
              onSelect={(index) => handleSelect(item, index)}
            />
          )
        })}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color={THEME.brand}>
        Reconciliation — {items.length} item{items.length !== 1 ? 's' : ''} to resolve
      </Text>

      {renderGroup('New files on disk:', additions)}
      {renderGroup('Missing from disk:', missing)}
      {renderGroup('Front matter detected:', frontMatter)}

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
