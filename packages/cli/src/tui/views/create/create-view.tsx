import { DEFAULT_VERSION } from '@agent-facets/engine'
import { parseFacetName, validateAssetNameSegment, validateFacetName } from '@agent-facets/protocol'
import { Box, Text } from 'ink'
import { useCallback, useEffect } from 'react'
import type { AssetType } from '../../../commands/create/types'
import { AssetSection } from '../../components/asset-section.tsx'
import { BooleanToggle } from '../../components/boolean-toggle.tsx'
import { Button } from '../../components/button.tsx'
import { EditableField } from '../../components/editable-field.tsx'
import { useFocusOrder } from '../../context/focus-order-context.ts'
import { useFormState } from '../../context/form-state-context.ts'
import { WizardLayout } from '../../layouts/wizard-layout.tsx'

const ASSET_TYPES: AssetType[] = ['skill', 'command', 'agent']

const ASSET_LABELS: Record<AssetType, string> = {
  skill: 'Skills',
  agent: 'Agents',
  command: 'Commands',
}

function computeFocusIds(form: ReturnType<typeof useFormState>['form']): string[] {
  // NOTE: `field-private` sits between `field-version` and the asset controls.
  // This focus list is duplicated in edit-view.tsx; keep both in lockstep.
  const ids: string[] = ['field-name', 'field-description', 'field-version', 'field-private']

  for (const type of ASSET_TYPES) {
    const section = form.assets[type]

    for (let i = 0; i < section.items.length; i++) {
      ids.push(`item-${type}-${i}`)
    }

    ids.push(`add-${type}`)
  }

  ids.push('create-btn')

  return ids
}

export function CreateView({
  onSubmit,
  onEditDescription,
}: {
  onSubmit: () => void
  onEditDescription?: (section: import('../../context/form-state-context.ts').AssetSectionKey, name: string) => void
}) {
  const { form, setPrivate } = useFormState()
  const { setFocusIds, focus, focusedId } = useFocusOrder()

  // Facet identity: an unscoped slug (`my-facet`) or a scoped `@scope/name`
  // (`@acme/my-facet`). Asset names (below) stay kebab-case only.
  const validateName = useCallback((v: string) => {
    if (!v) return undefined
    const result = validateFacetName(v)
    if (!result.ok) return 'Must be a facet name (e.g., my-facet or @scope/name)'
    return undefined
  }, [])

  // Derived state from context
  const nameConfirmed = form.fields.name.status === 'confirmed'
  const descriptionConfirmed = form.fields.description.status === 'confirmed'
  const versionConfirmed = form.fields.version.status === 'confirmed'

  // Settled = confirmed or has a value (being revised). Used for dimming.
  const nameSettled = nameConfirmed || !!form.fields.name.value
  const descriptionSettled = descriptionConfirmed || !!form.fields.description.value
  const versionSettled = versionConfirmed || !!form.fields.version.value

  const descriptionReady = nameSettled
  const versionReady = nameSettled && descriptionSettled
  const assetsReady = nameSettled && descriptionSettled && versionSettled

  const totalAssets = form.assets.skill.items.length + form.assets.command.items.length + form.assets.agent.items.length
  const canCreate = assetsReady && totalAssets > 0

  // The first asset of each type defaults its name to the facet's unscoped
  // base segment (`@acme/cowsay` → `cowsay`), so the suggestion is always a
  // valid kebab asset name. Falls back to the raw value while the name is
  // still being typed / invalid.
  const defaultAssetName = (() => {
    const raw = form.fields.name.value
    if (!raw) return undefined
    const parsed = parseFacetName(raw)
    return parsed.ok ? parsed.value.name : raw
  })()

  // Recompute focus order
  useEffect(() => {
    const ids = computeFocusIds(form)
    setFocusIds(ids)

    if (focusedId && !ids.includes(focusedId)) {
      focus(ids[0] ?? '')
    }
  }, [form, setFocusIds, focus, focusedId])

  // Auto-focus name field on mount
  useEffect(() => {
    if (!focusedId) {
      focus('field-name')
    }
  }, [focusedId, focus])

  return (
    <WizardLayout>
      <EditableField
        field="name"
        label="Name"
        placeholder="my-facet"
        hint="name or @scope/name"
        validate={validateName}
        onConfirm={() => focus('field-description')}
      />

      <EditableField
        field="description"
        label="Description"
        placeholder="A brief description of what this facet does"
        dimmed={!descriptionReady}
        onConfirm={() => focus('field-version')}
      />

      <EditableField
        field="version"
        label="Version"
        hint="SemVer N.N.N"
        defaultValue={DEFAULT_VERSION}
        dimmed={!versionReady}
        validate={(v) => (/^\d+\.\d+\.\d+$/.test(v) ? undefined : `Must be SemVer (e.g., ${DEFAULT_VERSION})`)}
        onConfirm={() => focus('field-private')}
      />

      <BooleanToggle
        id="field-private"
        label="Privacy"
        value={form.private}
        onLabel="Private"
        offLabel="Public"
        onToggle={setPrivate}
        dimmed={!assetsReady}
        onConfirm={() => focus(`add-${ASSET_TYPES[0]}`)}
      />

      {ASSET_TYPES.map((type) => (
        <Box key={type} marginTop={0}>
          <AssetSection
            section={type}
            label={ASSET_LABELS[type]}
            defaultName={form.assets[type].items.length === 0 ? defaultAssetName : undefined}
            dimmed={!assetsReady}
            onEditDescription={onEditDescription}
            validate={(v) => {
              const check = validateAssetNameSegment(v)
              if (!check.ok) return `Name ${check.reason}`
              const editing = form.assets[type].editing
              if (form.assets[type].items.some((item) => item === v && item !== editing)) return `"${v}" already exists`
              return undefined
            }}
          />
        </Box>
      ))}

      <Box marginTop={1}>
        <Button
          id="create-btn"
          label="[ Create facet ]"
          color="green"
          disabled={!canCreate}
          gradient={canCreate}
          animateGradient={canCreate && focusedId === 'create-btn'}
          onPress={onSubmit}
        />
      </Box>

      {!canCreate && (
        <Box marginLeft={2}>
          <Text dimColor>
            {!nameConfirmed
              ? 'Enter a name to continue'
              : !descriptionConfirmed
                ? 'Enter a description to continue'
                : !versionConfirmed
                  ? 'Enter a version to continue'
                  : 'Add at least one skill, agent, or command'}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑ ↓ to navigate, Enter to select/edit, Esc Esc to exit</Text>
      </Box>
    </WizardLayout>
  )
}
