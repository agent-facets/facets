import type { FacetManifest } from '@agent-facets/protocol'
import type { ReadmePath } from '../readme.ts'
import type { AssetManifestKey } from './scanner.ts'

/**
 * Where a supplementary file is declared. `root` is the manifest's top-level
 * `files` array (repo-relative paths); `skill` is a skill descriptor's `files`
 * array (paths relative to that skill's directory).
 */
export type DeclarationSite = { kind: 'root' } | { kind: 'skill'; skill: string }

/**
 * A reconciliation item needing a resolution before editing proceeds. Each
 * variant carries a structured identity — no colon-joined string that a
 * consumer must parse back into fields. Path-bearing supplementary variants are
 * distinct from asset variants so classification never rides on optional
 * fields. README paths are NEVER represented here; they are handled by the
 * dedicated README panel (see `ReadmeFileState`).
 */
export type ReconciliationItem =
  | { kind: 'asset-addition'; assetType: AssetManifestKey; name: string; path: string }
  | { kind: 'asset-missing'; assetType: AssetManifestKey; name: string; expectedPath: string }
  | { kind: 'companion-addition'; skill: string; relPath: string; path: string }
  | { kind: 'companion-missing'; skill: string; relPath: string; expectedPath: string }
  | { kind: 'root-addition'; path: string }
  | { kind: 'root-missing'; path: string }

/**
 * The resolution chosen for a reconciliation item. `add`/`ignore` are the only
 * legal actions for an *-addition item; `scaffold`/`remove` the only legal
 * actions for a *-missing item. Resolutions are produced solely by
 * `resolutionForOption` (see reconcile-actions.ts), so an illegal item/action
 * pairing is never constructed.
 */
export type ReconciliationResolution =
  | { action: 'add' }
  | { action: 'ignore' }
  | { action: 'scaffold' }
  | { action: 'remove' }

/**
 * State of one conventional README path (`README.md` or `README`), managed
 * independently in the dedicated README panel. Present states carry the current
 * on-disk content so the panel can seed the editor; adoption preserves those
 * bytes by queuing no file write.
 */
export type ReadmeFileState =
  | { path: ReadmePath; state: 'present-declared'; content: string }
  | { path: ReadmePath; state: 'present-undeclared'; content: string }
  | { path: ReadmePath; state: 'declared-missing' }
  | { path: ReadmePath; state: 'absent-undeclared' }

/** All data needed to run the edit TUI. */
export interface EditContext {
  rootDir: string
  manifest: FacetManifest
  reconciliationItems: ReconciliationItem[]
  /** Exactly the two conventional README paths, each with its independent state. */
  readme: ReadmeFileState[]
}

/** The result of the edit wizard — either applied changes or cancelled. */
export type EditResult = { outcome: 'applied'; operations: EditOperation[] } | { outcome: 'cancelled' }

/**
 * A queued edit operation. The final manifest travels inside `write-manifest`
 * so one operations list drives the whole transactional apply. Every file
 * operation carries an exact repo-relative path for the confirmation preview.
 */
export type EditOperation =
  | { op: 'write-manifest'; manifest: FacetManifest }
  | { op: 'scaffold-asset'; assetType: AssetManifestKey; name: string }
  | { op: 'delete-asset'; assetType: AssetManifestKey; name: string; companionPaths: string[] }
  | { op: 'write-file'; path: string; content: string }
  | { op: 'delete-file'; path: string }
