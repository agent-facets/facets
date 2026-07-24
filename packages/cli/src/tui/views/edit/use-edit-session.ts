import {
  addSkillCompanion,
  addTopLevelFile,
  type EditContext,
  type EditOperation,
  type EditResult,
  type ReconciliationItem,
  type ReconciliationResolution,
  reconciliationItemKey,
  removeSkillCompanion,
  removeTopLevelFile,
} from '@agent-facets/engine'
import type { FacetManifest } from '@agent-facets/protocol'
import { useCallback, useState } from 'react'
import type { AssetSectionKey, FormState } from '../../context/form-state-context.ts'

/** A resolved reconciliation item: the structured item plus the chosen action. */
export interface ResolvedItem {
  item: ReconciliationItem
  resolution: ReconciliationResolution
}

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
  // removes a spread-in `private: true`.
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
      // Start each descriptor from the original so descriptor-level metadata
      // (per-asset `adapters`, and skill `files` companion declarations) survives
      // the round-trip. Only `description` is overwritten from the form.
      const originalSection = original[manifestKey]
      const section: NonNullable<FacetManifest[typeof manifestKey]> = {}
      for (const name of items) {
        const originalDescriptor = originalSection?.[name]
        section[name] = {
          ...originalDescriptor,
          description: form.assets[formKey].descriptions[name] ?? '',
        }
      }
      manifest[manifestKey] = section
    } else {
      delete manifest[manifestKey]
    }
  }

  return manifest
}

/**
 * Apply supplementary-declaration deltas (companion/root add/remove) to the
 * form-derived manifest. Supplementary files are not modeled in the form, so
 * their declaration changes are applied here as pure manifest mutations. README
 * declarations are handled by the README panel, not here.
 */
function applySupplementaryDeltas(manifest: FacetManifest, resolved: ResolvedItem[]): FacetManifest {
  let next = manifest
  for (const { item, resolution } of resolved) {
    switch (item.kind) {
      case 'companion-addition':
        if (resolution.action === 'add') next = addSkillCompanion(next, item.skill, item.relPath)
        break
      case 'companion-missing':
        if (resolution.action === 'remove') next = removeSkillCompanion(next, item.skill, item.relPath)
        break
      case 'root-addition':
        if (resolution.action === 'add') next = addTopLevelFile(next, item.path)
        break
      case 'root-missing':
        if (resolution.action === 'remove') next = removeTopLevelFile(next, item.path)
        break
      // asset-* items are reflected through the form / operation list.
    }
  }
  return next
}

/** Builds the queued operation list from resolutions + form asset changes. */
function buildOperations(
  context: EditContext,
  form: FormState,
  resolved: ResolvedItem[],
  finalManifest: FacetManifest,
): EditOperation[] {
  const operations: EditOperation[] = [{ op: 'write-manifest', manifest: finalManifest }]

  // Supplementary + asset scaffolds driven by reconciliation resolutions.
  for (const { item, resolution } of resolved) {
    if (item.kind === 'asset-missing' && resolution.action === 'scaffold') {
      operations.push({ op: 'scaffold-asset', assetType: item.assetType, name: item.name })
    }
    // Missing supplementary files scaffold as empty bytes (valid content).
    if (item.kind === 'companion-missing' && resolution.action === 'scaffold') {
      operations.push({ op: 'write-file', path: item.expectedPath, content: '' })
    }
    if (item.kind === 'root-missing' && resolution.action === 'scaffold') {
      operations.push({ op: 'write-file', path: item.path, content: '' })
    }
  }

  // Names already present on disk (discovered additions) MUST NOT be scaffolded
  // over — that would overwrite an existing file with a template.
  const onDiskAssetNames = new Set(
    context.reconciliationItems
      .filter((i): i is Extract<ReconciliationItem, { kind: 'asset-addition' }> => i.kind === 'asset-addition')
      .map((i) => `${i.assetType}:${i.name}`),
  )

  for (const [formKey, manifestKey] of Object.entries(FORM_TO_MANIFEST) as [
    AssetSectionKey,
    'skills' | 'agents' | 'commands',
  ][]) {
    const originalNames = Object.keys(context.manifest[manifestKey] ?? {})

    // Genuinely new assets added in the form → scaffold a starter file.
    for (const name of form.assets[formKey].items) {
      if (originalNames.includes(name)) continue
      if (onDiskAssetNames.has(`${manifestKey}:${name}`)) continue
      operations.push({ op: 'scaffold-asset', assetType: manifestKey, name })
    }

    // Removed assets → delete the primary and any declared companions (skills).
    for (const name of originalNames) {
      if (form.assets[formKey].items.includes(name)) continue
      const companionPaths =
        manifestKey === 'skills'
          ? (context.manifest.skills?.[name]?.files ?? []).map((rel) => `skills/${name}/${rel}`)
          : []
      operations.push({ op: 'delete-asset', assetType: manifestKey, name, companionPaths })
    }
  }

  return operations
}

export function useEditSession(context: EditContext, initialResolutions?: Map<string, ResolvedItem>) {
  const [resolutions, setResolutions] = useState<Map<string, ResolvedItem>>(() => new Map(initialResolutions))

  const resolve = useCallback((item: ReconciliationItem, resolution: ReconciliationResolution) => {
    setResolutions((prev) => {
      const next = new Map(prev)
      next.set(reconciliationItemKey(item), { item, resolution })
      return next
    })
  }, [])

  const buildResult = useCallback(
    (form: FormState): EditResult => {
      const resolved = Array.from(resolutions.values())
      const finalManifest = applySupplementaryDeltas(buildManifest(context.manifest, form), resolved)
      const operations = buildOperations(context, form, resolved, finalManifest)
      return { outcome: 'applied', operations }
    },
    [context, resolutions],
  )

  return { resolutions, resolve, buildResult }
}
