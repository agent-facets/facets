import type { ReconciliationItem, ReconciliationResolution } from './types.ts'

/**
 * Correlation logic between a reconciliation item and its legal actions, and a
 * one-way stable identity key. Centralized so the two legal actions per item
 * and the item→resolution mapping have a single source of truth, and so illegal
 * item/action pairings (e.g. `remove` on an addition) are never constructed.
 *
 * `reconciliationItemKey` is a *rendering/lookup* key only — it is never parsed
 * back into fields. Business logic carries the structured item itself.
 */

/** True for the three "found on disk, not declared" variants. */
export function isAdditionItem(item: ReconciliationItem): boolean {
  return item.kind === 'asset-addition' || item.kind === 'companion-addition' || item.kind === 'root-addition'
}

/** The two option labels for an item, in index order. */
export function optionLabelsFor(item: ReconciliationItem): [string, string] {
  return isAdditionItem(item) ? ['Add to manifest', 'Ignore for now'] : ['Scaffold template', 'Remove from manifest']
}

/** The resolution for a chosen option index. Only legal actions are produced. */
export function resolutionForOption(item: ReconciliationItem, index: number): ReconciliationResolution {
  if (isAdditionItem(item)) return index === 0 ? { action: 'add' } : { action: 'ignore' }
  return index === 0 ? { action: 'scaffold' } : { action: 'remove' }
}

/** The selected option index for a stored resolution, or null if none/invalid. */
export function optionIndexForResolution(
  item: ReconciliationItem,
  resolution: ReconciliationResolution | undefined,
): number | null {
  if (!resolution) return null
  if (isAdditionItem(item)) {
    return resolution.action === 'add' ? 0 : resolution.action === 'ignore' ? 1 : null
  }
  return resolution.action === 'scaffold' ? 0 : resolution.action === 'remove' ? 1 : null
}

/** A stable, injective, one-way key for React lists and focus ids. Never parsed. */
export function reconciliationItemKey(item: ReconciliationItem): string {
  switch (item.kind) {
    case 'asset-addition':
    case 'asset-missing':
      return `asset:${item.assetType}:${item.name}`
    case 'companion-addition':
    case 'companion-missing':
      return `companion:${item.skill}:${item.relPath}`
    case 'root-addition':
    case 'root-missing':
      return `root:${item.path}`
  }
}
