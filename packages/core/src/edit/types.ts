import type { FacetManifest } from '../schemas/facet-manifest.ts'
import type { AssetManifestKey } from './scanner.ts'

/** A reconciliation item that needs a resolution before editing can proceed. */
export type ReconciliationItem =
  | { kind: 'addition'; type: AssetManifestKey; name: string; path: string }
  | { kind: 'missing'; type: AssetManifestKey; name: string; expectedPath: string }

/** The resolution chosen for a reconciliation item. */
export type ReconciliationResolution =
  | { action: 'add-to-manifest' }
  | { action: 'ignore' }
  | { action: 'scaffold-template' }
  | { action: 'remove-from-manifest' }

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
  | { op: 'scaffold'; type: AssetManifestKey; name: string }
  | { op: 'delete-file'; type: AssetManifestKey; name: string }
