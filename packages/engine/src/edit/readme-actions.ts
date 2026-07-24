import type { FacetManifest } from '@agent-facets/protocol'
import { README_MD, type ReadmePath, readmeTemplate } from '../readme.ts'
import { addTopLevelFile, removeTopLevelFile } from './declarations.ts'
import type { EditOperation, ReadmeFileState } from './types.ts'

/**
 * The action queued for one conventional README path, tagged so that each
 * variant is only ever constructed for a state that permits it (see
 * `readmeActionOptions`). Byte-preservation on adoption is structural: `adopt`
 * carries no content and therefore queues no file write, while every content
 * mutation (`edit`, `edit-and-adopt`, `create`, `scaffold`) carries the exact
 * bytes to write. There is no representable "adopt but also rewrite bytes"
 * combination.
 *
 * - `none`             — leave the path untouched (the default for every state).
 * - `edit`             — present & declared: rewrite bytes; declaration stays.
 * - `remove`           — present & declared: delete the file and its declaration.
 * - `adopt`            — present & undeclared: add the declaration only.
 * - `edit-and-adopt`   — present & undeclared: rewrite bytes and add declaration.
 * - `scaffold`         — declared & missing: write bytes at the exact declared path.
 * - `remove-declaration` — declared & missing: drop the declaration only.
 * - `create`           — absent & undeclared: write bytes and add the declaration.
 */
export type ReadmeAction =
  | { kind: 'none' }
  | { kind: 'edit'; content: string }
  | { kind: 'remove' }
  | { kind: 'adopt' }
  | { kind: 'edit-and-adopt'; content: string }
  | { kind: 'scaffold'; content: string }
  | { kind: 'remove-declaration' }
  | { kind: 'create'; content: string }

/** A README path paired with the action the author queued for it. */
export interface ReadmeResolution {
  path: ReadmePath
  action: ReadmeAction
}

/**
 * One selectable option in the README panel: a stable action `kind` (used to
 * reconstruct the tagged action and as a focus/lookup key) plus its label. The
 * two content-bearing option kinds are marked `requiresEditor` so the panel
 * knows to open the external editor before finalizing the action. Options are
 * legal-only per state — the panel never offers an action a state forbids.
 */
export interface ReadmeActionOption {
  /** The action variant this option produces. `none` is never listed. */
  kind: Exclude<ReadmeAction['kind'], 'none'>
  label: string
  /** True when choosing this option must gather content from the editor first. */
  requiresEditor: boolean
}

/**
 * The legal panel options for a README state, in display order. This is the
 * single source of truth for which actions each state permits; the panel
 * renders these and `readmeActionFor` maps a chosen option back to a tagged
 * action, so an illegal state/action pairing is never constructed.
 */
export function readmeActionOptions(state: ReadmeFileState): ReadmeActionOption[] {
  switch (state.state) {
    case 'present-declared':
      return [
        { kind: 'edit', label: 'Edit', requiresEditor: true },
        { kind: 'remove', label: 'Remove', requiresEditor: false },
      ]
    case 'present-undeclared':
      return [
        { kind: 'adopt', label: 'Adopt', requiresEditor: false },
        { kind: 'edit-and-adopt', label: 'Edit and adopt', requiresEditor: true },
      ]
    case 'declared-missing':
      return [
        { kind: 'scaffold', label: `Scaffold at ${state.path}`, requiresEditor: false },
        { kind: 'remove-declaration', label: 'Remove declaration', requiresEditor: false },
      ]
    case 'absent-undeclared':
      return [{ kind: 'create', label: 'Create', requiresEditor: true }]
  }
}

/**
 * Build the tagged action for a chosen option kind. `content` is required for
 * the content-bearing kinds and ignored otherwise; callers pass the
 * editor-produced bytes for editor options and the seed template for
 * non-editor content options. Returns `none` for any kind not legal here,
 * which never happens for options produced by `readmeActionOptions`.
 */
export function readmeActionFor(kind: ReadmeActionOption['kind'], content: string): ReadmeAction {
  switch (kind) {
    case 'edit':
      return { kind: 'edit', content }
    case 'remove':
      return { kind: 'remove' }
    case 'adopt':
      return { kind: 'adopt' }
    case 'edit-and-adopt':
      return { kind: 'edit-and-adopt', content }
    case 'scaffold':
      return { kind: 'scaffold', content }
    case 'remove-declaration':
      return { kind: 'remove-declaration' }
    case 'create':
      return { kind: 'create', content }
  }
}

/** The option kind a stored action corresponds to, or null for `none`. */
export function readmeOptionKindFor(action: ReadmeAction): ReadmeActionOption['kind'] | null {
  return action.kind === 'none' ? null : action.kind
}

/**
 * Apply a README path's declaration delta to the manifest. Content is never
 * touched here — file bytes travel as `write-file`/`delete-file` operations
 * (see `readmeFileOperations`). Adopt/edit-and-adopt/scaffold/create add the
 * declaration (idempotent); remove/remove-declaration drop it; edit/none leave
 * it as-is.
 */
export function applyReadmeDeclaration(manifest: FacetManifest, resolution: ReadmeResolution): FacetManifest {
  const { path, action } = resolution
  switch (action.kind) {
    case 'adopt':
    case 'edit-and-adopt':
    case 'create':
    case 'scaffold':
      return addTopLevelFile(manifest, path)
    case 'remove':
    case 'remove-declaration':
      return removeTopLevelFile(manifest, path)
    case 'edit':
    case 'none':
      return manifest
  }
}

/**
 * The exact-path file operations a README action queues. Content mutations emit
 * `write-file` at the exact path; removal emits `delete-file`. Adopt and
 * remove-declaration touch only the manifest and so emit no file operation —
 * adoption preserving on-disk bytes falls out of this structurally.
 */
export function readmeFileOperations(resolution: ReadmeResolution): EditOperation[] {
  const { path, action } = resolution
  switch (action.kind) {
    case 'edit':
    case 'edit-and-adopt':
    case 'scaffold':
    case 'create':
      return [{ op: 'write-file', path, content: action.content }]
    case 'remove':
      return [{ op: 'delete-file', path }]
    case 'adopt':
    case 'remove-declaration':
    case 'none':
      return []
  }
}

/** The seed content offered when an author opens the editor for a README path. */
export function readmeSeedContent(state: ReadmeFileState, name: string, description: string): string {
  switch (state.state) {
    case 'present-declared':
    case 'present-undeclared':
      // Existing bytes are the editor seed; the author edits from what is there.
      return state.content
    case 'declared-missing':
    case 'absent-undeclared':
      // No bytes on disk — seed from the facet identity, sharing the same
      // template create uses so there is one source of README seed content.
      return readmeTemplate(name, description)
  }
}

/** The default README path for Create (design D11: `README.md`). */
export const README_CREATE_DEFAULT: ReadmePath = README_MD
