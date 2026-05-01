import type {
  EditContext,
  EditOperation,
  EditResult,
  FacetManifest,
  ReconciliationResolution,
} from '@agent-facets/core'
import { useCallback, useState } from 'react'
import type { AssetSectionKey, FormState } from '../../context/form-state-context.ts'

/** Maps form section keys to manifest asset keys. */
const FORM_TO_MANIFEST: Record<AssetSectionKey, 'skills' | 'agents' | 'commands'> = {
  skill: 'skills',
  agent: 'agents',
  command: 'commands',
}

/** Builds a manifest from form state, preserving non-asset fields from the original. */
function buildManifest(original: FacetManifest, form: FormState): FacetManifest {
  const manifest: FacetManifest = {
    ...original,
    name: form.fields.name.value,
    version: form.fields.version.value,
  }

  if (form.fields.description.value) {
    manifest.description = form.fields.description.value
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
    const kind = parts[0]
    const assetType = parts[1] as 'skills' | 'agents' | 'commands'
    const name = parts[2]
    if (!kind || !assetType || !name) continue

    if (resolution.action === 'scaffold-template') {
      operations.push({ op: 'scaffold', type: assetType, name })
    } else if (resolution.action === 'remove-from-manifest' && kind === 'front-matter') {
      operations.push({ op: 'delete-file', type: assetType, name })
    } else if (resolution.action === 'strip-front-matter') {
      const item = context.reconciliationItems.find(
        (i) => i.kind === 'front-matter' && i.type === assetType && i.name === name,
      )
      if (item && 'path' in item) {
        operations.push({ op: 'strip-front-matter', type: assetType, name, path: item.path })
      }
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
