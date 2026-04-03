import type { FacetManifest } from '@agent-facets/core'
import type { AssetSectionKey, FormState } from '../../context/form-state-context.ts'

/** Maps manifest asset keys to form section keys. */
const MANIFEST_TO_FORM: Record<string, AssetSectionKey> = {
  skills: 'skill',
  agents: 'agent',
  commands: 'command',
}

/** Builds initial form state from an existing manifest. */
export function manifestToFormState(manifest: FacetManifest): FormState {
  const assets: FormState['assets'] = {
    skill: { items: [], descriptions: {}, editing: undefined, adding: false },
    agent: { items: [], descriptions: {}, editing: undefined, adding: false },
    command: { items: [], descriptions: {}, editing: undefined, adding: false },
  }

  for (const [manifestKey, formKey] of Object.entries(MANIFEST_TO_FORM)) {
    const section = manifest[manifestKey as keyof FacetManifest]
    if (section && typeof section === 'object' && !Array.isArray(section)) {
      const entries = section as Record<string, { description?: string }>
      for (const [name, descriptor] of Object.entries(entries)) {
        assets[formKey].items.push(name)
        assets[formKey].descriptions[name] = descriptor.description ?? `A ${name} ${formKey}`
      }
    }
  }

  return {
    fields: {
      name: { value: manifest.name, status: 'confirmed' },
      description: { value: manifest.description ?? '', status: 'confirmed' },
      version: { value: manifest.version, status: 'confirmed' },
    },
    assets,
  }
}
