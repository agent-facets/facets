import type { AssetType, FacetManifest } from '@agent-facets/core'

/** A reconciliation item that needs a resolution before editing can proceed. */
export type ReconciliationItem =
  | { kind: 'addition'; type: AssetType; name: string; path: string }
  | { kind: 'missing'; type: AssetType; name: string; expectedPath: string }
  | { kind: 'front-matter'; type: AssetType; name: string; path: string }

/** The resolution chosen for a reconciliation item. */
export type ReconciliationResolution =
  | { action: 'add-to-manifest' }
  | { action: 'ignore' }
  | { action: 'scaffold-template' }
  | { action: 'remove-from-manifest' }
  | { action: 'strip-front-matter' }

/** All data needed to run the edit TUI. */
export interface EditContext {
  rootDir: string
  manifest: FacetManifest
  reconciliationItems: ReconciliationItem[]
}

/** The result of the edit wizard — either applied changes or cancelled. */
export type EditResult =
  | { outcome: 'applied'; manifest: FacetManifest; operations: EditOperation[] }
  | { outcome: 'cancelled' }

/** A file operation to perform on confirmation. */
export type EditOperation =
  | { op: 'write-manifest' }
  | { op: 'scaffold'; type: AssetType; name: string }
  | { op: 'delete-file'; type: AssetType; name: string }
  | { op: 'strip-front-matter'; type: AssetType; name: string; path: string }
