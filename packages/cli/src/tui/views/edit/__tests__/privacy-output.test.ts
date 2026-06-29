import { describe, expect, test } from 'bun:test'
import type { FacetManifest } from '@agent-facets/protocol'
import type { FormState } from '../../../context/form-state-context.ts'
import { manifestToFormState } from '../manifest-to-form.ts'
import { buildManifest } from '../use-edit-session.ts'

/** A minimal valid manifest fixture with one skill. */
function manifest(overrides: Partial<FacetManifest> = {}): FacetManifest {
  return {
    name: 'cowsay',
    version: '0.0.0',
    skills: { cowsay: { description: 'A skill' } },
    ...overrides,
  } as FacetManifest
}

/** Form state derived from a manifest, with privacy overridable. */
function formFrom(m: FacetManifest, isPrivate?: boolean): FormState {
  const form = manifestToFormState(m)
  return isPrivate === undefined ? form : { ...form, private: isPrivate }
}

describe('manifestToFormState privacy hydration', () => {
  test('omitted private hydrates as public (false)', () => {
    expect(manifestToFormState(manifest()).private).toBe(false)
  })

  test('explicit private: false hydrates as public (false)', () => {
    expect(manifestToFormState(manifest({ private: false })).private).toBe(false)
  })

  test('private: true hydrates as private (true)', () => {
    expect(manifestToFormState(manifest({ private: true })).private).toBe(true)
  })
})

describe('buildManifest privacy output', () => {
  test('private form writes private: true', () => {
    const out = buildManifest(manifest(), formFrom(manifest(), true))
    expect(out.private).toBe(true)
  })

  test('public form with original private: false preserves false', () => {
    const original = manifest({ private: false })
    const out = buildManifest(original, formFrom(original, false))
    expect(out.private).toBe(false)
  })

  test('public form with original omitted omits private', () => {
    const original = manifest()
    const out = buildManifest(original, formFrom(original, false))
    expect('private' in out).toBe(false)
  })

  test('private original switched to public deletes private', () => {
    const original = manifest({ private: true })
    const out = buildManifest(original, formFrom(original, false))
    expect('private' in out).toBe(false)
  })

  test('public original switched to private writes private: true', () => {
    const original = manifest()
    const out = buildManifest(original, formFrom(original, true))
    expect(out.private).toBe(true)
  })

  test('preserves unrelated top-level fields', () => {
    const original = manifest({ author: 'jules', private: true })
    const out = buildManifest(original, formFrom(original, false))
    expect(out.author).toBe('jules')
    expect('private' in out).toBe(false)
  })
})

describe('buildManifest adapter-config preservation', () => {
  test('skill adapters survive an edit round-trip', () => {
    const original = manifest({
      skills: { cowsay: { description: 'A skill', adapters: { claude: { permission: { bash: 'ask' } } } } },
    })
    const out = buildManifest(original, formFrom(original))
    expect(out.skills?.cowsay?.adapters).toEqual({ claude: { permission: { bash: 'ask' } } })
  })

  test('agent adapters survive an edit round-trip', () => {
    const original = manifest({
      skills: undefined,
      agents: { reviewer: { description: 'An agent', adapters: { opencode: { model: 'gpt' } } } },
    } as Partial<FacetManifest>)
    const out = buildManifest(original, formFrom(original))
    expect(out.agents?.reviewer?.adapters).toEqual({ opencode: { model: 'gpt' } })
  })

  test('command adapters survive an edit round-trip', () => {
    const original = manifest({
      skills: undefined,
      commands: { deploy: { description: 'A command', adapters: { codex: { foo: 'bar' } } } },
    } as Partial<FacetManifest>)
    const out = buildManifest(original, formFrom(original))
    expect(out.commands?.deploy?.adapters).toEqual({ codex: { foo: 'bar' } })
  })

  test('editable description updates while adapter config is preserved', () => {
    const original = manifest({
      skills: { cowsay: { description: 'old', adapters: { claude: { x: 1 } } } },
    })
    const form = manifestToFormState(original)
    form.assets.skill.descriptions.cowsay = 'new'
    const out = buildManifest(original, form)
    expect(out.skills?.cowsay?.description).toBe('new')
    expect(out.skills?.cowsay?.adapters).toEqual({ claude: { x: 1 } })
  })

  test('newly added asset has no adapters block', () => {
    const original = manifest()
    const form = manifestToFormState(original)
    form.assets.skill.items.push('brand-new')
    form.assets.skill.descriptions['brand-new'] = 'fresh'
    const out = buildManifest(original, form)
    expect(out.skills?.['brand-new']).toEqual({ description: 'fresh' })
  })
})
