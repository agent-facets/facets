import type { EditContext, EditOperation, EditResult, ReconciliationResolution } from '@agent-facets/engine'
import type { FacetManifest } from '@agent-facets/protocol'
import { useCallback, useState } from 'react'
import type { AssetSectionKey, FormState } from '../../context/form-state-context.ts'

/** Maps form section keys to manifest asset keys. */
const FORM_TO_MANIFEST: Record<AssetSectionKey, 'skills' | 'agents' | 'commands'> = {
  skill: 'skills',
  agent: 'agents',
  command: 'commands',
}

/** Builds a manifest from form state, preserving non-asset fields from the original. */
export function buildManifest(original: FacetManifest, form: FormState): FacetManifest {
  const manifest: FacetManifest = {
    ...original,
    name: form.fields.name.value,
    version: form.fields.version.value,
  }

  if (form.fields.description.value) {
    manifest.description = form.fields.description.value
  }

  // Privacy is handled after `...original` so a private→public edit actively
  // removes a spread-in `private: true`. The form is binary, but the manifest
  // can represent public either by omission or by an explicit `private: false`:
  // - private              → write `private: true`
  // - public + original false → preserve `private: false` (already spread in)
  // - public + original omitted/true → delete `private`
  if (form.private) {
    manifest.private = true
  } else if (original.private !== false) {
    delete manifest.private
  }

  for (const [formKey, manifestKey] of Object.entries(FORM_TO_MANIFEST) as [
    AssetSectionKey,
    'skills' | 'agents' | 'commands',
  ][]) {
    const items = form.assets[formKey].items
    if (items.length > 0) {
      const section: Record<string, { description: string }> = {}
      for (const name of items) {
        section[name] = { description: form.assets[formKey].descriptions[name] ?? '' }
      }
      manifest[manifestKey] = section
    } else {
      delete manifest[manifestKey]
    }
  }

  return manifest
}

/** Builds the list of file operations from resolutions + form changes. */
function buildOperations(
  context: EditContext,
  form: FormState,
  resolutions: Map<string, ReconciliationResolution>,
): EditOperation[] {
  const operations: EditOperation[] = [{ op: 'write-manifest' }]

  // Operations from reconciliation resolutions
  for (const [key, resolution] of resolutions) {
    const parts = key.split(':')
    const assetType = parts[1] as 'skills' | 'agents' | 'commands'
    const name = parts[2]
    if (!assetType || !name) continue

    if (resolution.action === 'scaffold-template') {
      operations.push({ op: 'scaffold', type: assetType, name })
    }
  }

  // New assets added during editing (not from reconciliation)
  for (const [formKey, manifestKey] of Object.entries(FORM_TO_MANIFEST) as [
    AssetSectionKey,
    'skills' | 'agents' | 'commands',
  ][]) {
    const originalSection = context.manifest[manifestKey]
    const originalNames =
      originalSection && typeof originalSection === 'object' && !Array.isArray(originalSection)
        ? Object.keys(originalSection)
        : []

    for (const name of form.assets[formKey].items) {
      const isFromReconciliation = resolutions.has(`addition:${manifestKey}:${name}`)
      if (!originalNames.includes(name) && !isFromReconciliation) {
        operations.push({ op: 'scaffold', type: manifestKey, name })
      }
    }

    // Removed assets
    for (const name of originalNames) {
      if (!form.assets[formKey].items.includes(name)) {
        operations.push({ op: 'delete-file', type: manifestKey, name })
      }
    }
  }

  return operations
}

export function useEditSession(context: EditContext) {
  const [resolutions, setResolutions] = useState<Map<string, ReconciliationResolution>>(new Map())

  const resolve = useCallback((key: string, resolution: ReconciliationResolution) => {
    setResolutions((prev) => {
      const next = new Map(prev)
      next.set(key, resolution)
      return next
    })
  }, [])

  /** Builds the final edit result from current form state and resolutions. */
  const buildResult = useCallback(
    (form: FormState): EditResult => {
      const manifest = buildManifest(context.manifest, form)
      const operations = buildOperations(context, form, resolutions)
      return { outcome: 'applied', manifest, operations }
    },
    [context, resolutions],
  )

  return { resolutions, resolve, buildResult }
}
