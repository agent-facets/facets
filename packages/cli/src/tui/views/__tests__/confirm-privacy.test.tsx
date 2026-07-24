import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { FocusOrderProvider } from '../../context/focus-order-context.ts'
import { type FormState, FormStateProvider } from '../../context/form-state-context.ts'
import { ConfirmView } from '../create/confirm-view.tsx'
import { EditConfirmView } from '../edit/edit-confirm-view.tsx'

function formWith(isPrivate: boolean): FormState {
  return {
    fields: {
      name: { value: 'cowsay', status: 'confirmed' },
      description: { value: 'Cowsay tools', status: 'confirmed' },
      version: { value: '0.0.0', status: 'confirmed' },
    },
    private: isPrivate,
    readme: { enabled: false, draft: { origin: 'seeded', content: '' } },
    assets: {
      skill: { items: ['cowsay'], descriptions: { cowsay: 'A skill' }, editing: undefined, adding: false },
      command: { items: [], descriptions: {}, editing: undefined, adding: false },
      agent: { items: [], descriptions: {}, editing: undefined, adding: false },
    },
  }
}

function renderCreate(isPrivate: boolean) {
  return render(
    <FocusOrderProvider>
      <FormStateProvider initialState={formWith(isPrivate)}>
        <ConfirmView
          opts={{
            name: 'cowsay',
            version: '0.0.0',
            description: 'Cowsay tools',
            skills: ['cowsay'],
            agents: [],
            commands: [],
            readme: { kind: 'disabled' },
            ...(isPrivate ? { private: true as const } : {}),
          }}
          onConfirm={() => {}}
          onBack={() => {}}
        />
      </FormStateProvider>
    </FocusOrderProvider>,
  )
}

function renderEdit(isPrivate: boolean) {
  return render(
    <FocusOrderProvider>
      <FormStateProvider initialState={formWith(isPrivate)}>
        <EditConfirmView operations={[]} onConfirm={() => {}} onBack={() => {}} />
      </FormStateProvider>
    </FocusOrderProvider>,
  )
}

describe('create confirmation summary privacy', () => {
  test('shows Public for a public facet', () => {
    const instance = renderCreate(false)
    const frame = instance.lastFrame() ?? ''
    expect(frame).toContain('Privacy:')
    expect(frame).toContain('Public')
    instance.unmount()
  })

  test('shows Private for a private facet', () => {
    const instance = renderCreate(true)
    expect(instance.lastFrame()).toContain('Private')
    instance.unmount()
  })
})

describe('edit confirmation summary privacy', () => {
  test('shows Public for a public facet', () => {
    const instance = renderEdit(false)
    const frame = instance.lastFrame() ?? ''
    expect(frame).toContain('Privacy:')
    expect(frame).toContain('Public')
    instance.unmount()
  })

  test('shows Private for a private facet', () => {
    const instance = renderEdit(true)
    expect(instance.lastFrame()).toContain('Private')
    instance.unmount()
  })
})
