import { type ScaffoldOptions as CreateOptions, readmeTemplate } from '@agent-facets/engine'
import { validateAssetNameSegment } from '@agent-facets/protocol'
import type { ReactNode } from 'react'
import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react'

// --- Types ---

export type FieldStatus = 'empty' | 'editing' | 'confirmed'
export type RequiredFieldKey = 'name' | 'description' | 'version'
export type AssetSectionKey = 'skill' | 'command' | 'agent'

export interface FieldState {
  value: string
  status: FieldStatus
}

export interface AssetSectionState {
  items: string[]
  descriptions: Record<string, string>
  editing?: string
  adding: boolean
}

/**
 * Create-wizard README state.
 *
 * `enabled` is the author's default-on/opt-out choice; the `draft` is always
 * present so toggling README off and back on never loses authored content.
 *
 * `draft.origin` guards regeneration: while `seeded`, identity edits refresh
 * the template; the first explicit README edit flips it to `authored` and it
 * is then preserved verbatim across later identity edits (design D11 — "the
 * generated template is an initial value only").
 */
export interface ReadmeState {
  enabled: boolean
  draft: { origin: 'seeded' | 'authored'; content: string }
}

export interface FormState {
  fields: {
    name: FieldState
    description: FieldState
    version: FieldState
  }
  // Author-facing privacy intent. This is a sibling of `fields` (not a member)
  // because `fields` is a fixed map of string-valued `FieldState`s, whereas
  // privacy is a binary choice. The UI has exactly two states — public and
  // private — and `false` is the public default. Omission-vs-explicit-`false`
  // in the manifest is a serialization concern handled at the output boundary
  // (scaffold generation for create, `buildManifest` for edit), not here.
  private: boolean
  readme: ReadmeState
  assets: {
    skill: AssetSectionState
    command: AssetSectionState
    agent: AssetSectionState
  }
}

// --- Context value ---

interface FormStateContextValue {
  form: FormState

  // Field operations
  setFieldValue: (field: RequiredFieldKey, value: string) => void
  setFieldStatus: (field: RequiredFieldKey, status: FieldStatus) => void

  // Privacy operation
  setPrivate: (value: boolean) => void

  // README operations
  setReadmeEnabled: (value: boolean) => void
  setReadmeContent: (content: string) => void

  // Asset operations
  addAsset: (section: AssetSectionKey, name: string) => void
  removeAsset: (section: AssetSectionKey, name: string) => void
  renameAsset: (section: AssetSectionKey, oldName: string, newName: string) => void
  setAssetDescription: (section: AssetSectionKey, name: string, description: string) => void
  setAssetAdding: (section: AssetSectionKey, adding: boolean) => void
  setAssetEditing: (section: AssetSectionKey, name?: string) => void

  // Build CreateOptions for scaffold
  toCreateOptions: () => CreateOptions
}

// --- Defaults ---

const defaultAssetSection: AssetSectionState = {
  items: [],
  descriptions: {},
  editing: undefined,
  adding: false,
}

/** README defaults on for interactive create, seeded from the (empty) identity. */
const defaultReadme: ReadmeState = {
  enabled: true,
  draft: { origin: 'seeded', content: readmeTemplate('', '') },
}

const defaultForm: FormState = {
  fields: {
    name: { value: '', status: 'empty' },
    description: { value: '', status: 'empty' },
    version: { value: '', status: 'empty' },
  },
  private: false,
  readme: { enabled: defaultReadme.enabled, draft: { ...defaultReadme.draft } },
  assets: {
    skill: { ...defaultAssetSection },
    command: { ...defaultAssetSection },
    agent: { ...defaultAssetSection },
  },
}

const FormStateContext = createContext<FormStateContextValue>({
  form: defaultForm,
  setFieldValue: () => {},
  setFieldStatus: () => {},
  setPrivate: () => {},
  setReadmeEnabled: () => {},
  setReadmeContent: () => {},
  addAsset: () => {},
  removeAsset: () => {},
  renameAsset: () => {},
  setAssetDescription: () => {},
  setAssetAdding: () => {},
  setAssetEditing: () => {},
  toCreateOptions: () => ({
    name: '',
    version: '',
    description: '',
    skills: [],
    commands: [],
    agents: [],
    readme: { kind: 'enabled', content: readmeTemplate('', '') },
  }),
})

// --- Provider ---

export function FormStateProvider({ children, initialState }: { children: ReactNode; initialState?: FormState }) {
  const [form, setForm] = useState<FormState>(initialState ?? defaultForm)

  const setFieldValue = useCallback((field: RequiredFieldKey, value: string) => {
    setForm((prev) => {
      const fields = {
        ...prev.fields,
        [field]: { ...prev.fields[field], value },
      }
      // While the README draft is still the seeded template, identity edits
      // re-seed it from the new name/description. Once authored, it is frozen.
      let readme = prev.readme
      if ((field === 'name' || field === 'description') && prev.readme.draft.origin === 'seeded') {
        const nextName = field === 'name' ? value : prev.fields.name.value
        const nextDescription = field === 'description' ? value : prev.fields.description.value
        readme = { ...prev.readme, draft: { origin: 'seeded', content: readmeTemplate(nextName, nextDescription) } }
      }
      return { ...prev, fields, readme }
    })
  }, [])

  const setFieldStatus = useCallback((field: RequiredFieldKey, status: FieldStatus) => {
    setForm((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [field]: { ...prev.fields[field], status },
      },
    }))
  }, [])

  const setPrivate = useCallback((value: boolean) => {
    setForm((prev) => ({ ...prev, private: value }))
  }, [])

  const setReadmeEnabled = useCallback((value: boolean) => {
    setForm((prev) => ({ ...prev, readme: { ...prev.readme, enabled: value } }))
  }, [])

  const setReadmeContent = useCallback((content: string) => {
    // An explicit edit freezes the draft: identity edits no longer re-seed it.
    setForm((prev) => ({ ...prev, readme: { ...prev.readme, draft: { origin: 'authored', content } } }))
  }, [])

  const addAsset = useCallback((section: AssetSectionKey, name: string) => {
    if (!validateAssetNameSegment(name).ok) return
    setForm((prev) => {
      const current = prev.assets[section]
      if (current.items.includes(name)) return prev
      const defaultDesc = `The ${name} ${section} description`
      return {
        ...prev,
        assets: {
          ...prev.assets,
          [section]: {
            ...current,
            items: [...current.items, name],
            descriptions: { ...current.descriptions, [name]: defaultDesc },
          },
        },
      }
    })
  }, [])

  const removeAsset = useCallback((section: AssetSectionKey, name: string) => {
    setForm((prev) => {
      const current = prev.assets[section]
      const { [name]: _, ...remainingDescs } = current.descriptions
      return {
        ...prev,
        assets: {
          ...prev.assets,
          [section]: {
            ...current,
            items: current.items.filter((item) => item !== name),
            descriptions: remainingDescs,
            editing: current.editing === name ? undefined : current.editing,
          },
        },
      }
    })
  }, [])

  const renameAsset = useCallback((section: AssetSectionKey, oldName: string, newName: string) => {
    if (!validateAssetNameSegment(newName).ok) return
    setForm((prev) => {
      const current = prev.assets[section]
      if (current.items.includes(newName)) return prev
      const { [oldName]: desc, ...restDescs } = current.descriptions
      return {
        ...prev,
        assets: {
          ...prev.assets,
          [section]: {
            ...current,
            items: current.items.map((item) => (item === oldName ? newName : item)),
            descriptions: { ...restDescs, [newName]: desc ?? `A ${newName} ${section}` },
            editing: current.editing === oldName ? newName : current.editing,
          },
        },
      }
    })
  }, [])

  const setAssetDescription = useCallback((section: AssetSectionKey, name: string, description: string) => {
    setForm((prev) => {
      const current = prev.assets[section]
      return {
        ...prev,
        assets: {
          ...prev.assets,
          [section]: {
            ...current,
            descriptions: { ...current.descriptions, [name]: description },
          },
        },
      }
    })
  }, [])

  const setAssetAdding = useCallback((section: AssetSectionKey, adding: boolean) => {
    setForm((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        [section]: { ...prev.assets[section], adding },
      },
    }))
  }, [])

  const setAssetEditing = useCallback((section: AssetSectionKey, name?: string) => {
    setForm((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        [section]: { ...prev.assets[section], editing: name },
      },
    }))
  }, [])

  const toCreateOptions = useCallback(
    (): CreateOptions => ({
      name: form.fields.name.value,
      version: form.fields.version.value,
      description: form.fields.description.value,
      skills: form.assets.skill.items,
      commands: form.assets.command.items,
      agents: form.assets.agent.items,
      readme: form.readme.enabled ? { kind: 'enabled', content: form.readme.draft.content } : { kind: 'disabled' },
      // True-only: public is represented by omission, never `private: false`.
      ...(form.private ? { private: true } : {}),
    }),
    [form],
  )

  const value = useMemo<FormStateContextValue>(
    () => ({
      form,
      setFieldValue,
      setFieldStatus,
      setPrivate,
      setReadmeEnabled,
      setReadmeContent,
      addAsset,
      removeAsset,
      renameAsset,
      setAssetDescription,
      setAssetAdding,
      setAssetEditing,
      toCreateOptions,
    }),
    [
      form,
      setFieldValue,
      setFieldStatus,
      setPrivate,
      setReadmeEnabled,
      setReadmeContent,
      addAsset,
      removeAsset,
      renameAsset,
      setAssetDescription,
      setAssetAdding,
      setAssetEditing,
      toCreateOptions,
    ],
  )

  return createElement(FormStateContext.Provider, { value }, children)
}

// --- Hook ---

export function useFormState() {
  return useContext(FormStateContext)
}
