import { describe, expect, test } from 'bun:test'
import type { FormState } from '../../context/form-state-context.ts'
import { validateAssetNameInWizard } from '../validate-asset-name.ts'

function assets(overrides: Partial<FormState['assets']> = {}): FormState['assets'] {
  const empty = { items: [] as string[], descriptions: {}, adding: false }
  return {
    skill: { ...empty },
    command: { ...empty },
    agent: { ...empty },
    ...overrides,
  }
}

describe('validateAssetNameInWizard', () => {
  test('accepts a valid, unused single-segment name', () => {
    expect(validateAssetNameInWizard('skill', 'code-review', assets())).toBeUndefined()
  })

  test('rejects an invalid single-segment name', () => {
    const err = validateAssetNameInWizard('skill', 'Code_Review', assets())
    expect(err).toBeString()
    expect(err).toContain('Name')
  })

  test('rejects a duplicate within the same type', () => {
    const state = assets({ skill: { items: ['review'], descriptions: {}, adding: false } })
    expect(validateAssetNameInWizard('skill', 'review', state)).toContain('already exists')
  })

  test('allows editing an item to its own name', () => {
    const state = assets({ skill: { items: ['review'], descriptions: {}, adding: false, editing: 'review' } })
    expect(validateAssetNameInWizard('skill', 'review', state)).toBeUndefined()
  })

  test('rejects a command that collides with an existing skill (shared namespace)', () => {
    const state = assets({ skill: { items: ['review'], descriptions: {}, adding: false } })
    const err = validateAssetNameInWizard('command', 'review', state)
    expect(err).toContain('already used by a skill')
    expect(err).toContain('share one namespace')
  })

  test('rejects a skill that collides with an existing command (shared namespace)', () => {
    const state = assets({ command: { items: ['review'], descriptions: {}, adding: false } })
    const err = validateAssetNameInWizard('skill', 'review', state)
    expect(err).toContain('already used by a command')
  })

  test('allows an agent to share a name with a skill (separate namespace)', () => {
    const state = assets({ skill: { items: ['review'], descriptions: {}, adding: false } })
    expect(validateAssetNameInWizard('agent', 'review', state)).toBeUndefined()
  })

  test('allows an agent to share a name with a command (separate namespace)', () => {
    const state = assets({ command: { items: ['review'], descriptions: {}, adding: false } })
    expect(validateAssetNameInWizard('agent', 'review', state)).toBeUndefined()
  })
})
