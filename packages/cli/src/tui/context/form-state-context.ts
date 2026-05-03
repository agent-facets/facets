import { type ScaffoldOptions as CreateOptions, isValidKebabCase } from '@agent-facets/engine'
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

export interface FormState {
  fields: {
    name: FieldState
    description: FieldState
    version: FieldState
  }
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

const defaultForm: FormState = {
  fields: {
    name: { value: '', status: 'empty' },
    description: { value: '', status: 'empty' },
    version: { value: '', status: 'empty' },
  },
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
  addAsset: () => {},
  removeAsset: () => {},
  renameAsset: () => {},
  setAssetDescription: () => {},
  setAssetAdding: () => {},
  setAssetEditing: () => {},
  toCreateOptions: () => ({ name: '', version: '', description: '', skills: [], commands: [], agents: [] }),
})

// --- Provider ---

export function FormStateProvider({ children, initialState }: { children: ReactNode; initialState?: FormState }) {
  const [form, setForm] = useState<FormState>(initialState ?? defaultForm)

  const setFieldValue = useCallback((field: RequiredFieldKey, value: string) => {
    setForm((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [field]: { ...prev.fields[field], value },
      },
    }))
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

  const addAsset = useCallback((section: AssetSectionKey, name: string) => {
    if (!isValidKebabCase(name)) return
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
    if (!isValidKebabCase(newName)) return
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
    }),
    [form],
  )

  const value = useMemo<FormStateContextValue>(
    () => ({
      form,
      setFieldValue,
      setFieldStatus,
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
