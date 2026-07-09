import { describe, expect, test } from 'bun:test'
import type { FacetManifest } from '@agent-facets/protocol'
import { applyModify, type ModifyOp } from '../edit/apply-modify.ts'

function baseManifest(overrides: Partial<FacetManifest> = {}): FacetManifest {
  return {
    name: 'my-facet',
    version: '0.1.0',
    skills: { greet: { description: 'A greeting skill' } },
    ...overrides,
  } as FacetManifest
}

describe('applyModify — add', () => {
  test('adds a new asset with a scaffold file op', () => {
    const result = applyModify(baseManifest(), {
      kind: 'add',
      target: 'agents',
      name: 'helper',
      mutations: [{ field: 'description', value: 'A helper agent' }],
    })
    if (!result.ok) expect.unreachable()
    expect(result.manifest.agents?.helper?.description).toBe('A helper agent')
    expect(result.fileOps).toEqual([{ op: 'scaffold', target: 'agents', name: 'helper' }])
  })

  test('rejects adding an asset that already exists', () => {
    const result = applyModify(baseManifest(), { kind: 'add', target: 'skills', name: 'greet', mutations: [] })
    if (result.ok) expect.unreachable()
    if (result.error.reason !== 'asset-exists') expect.unreachable()
    expect(result.error.name).toBe('greet')
  })

  test('adds with an adapter config in the same call', () => {
    const result = applyModify(baseManifest(), {
      kind: 'add',
      target: 'skills',
      name: 'lint',
      mutations: [
        { field: 'description', value: 'Lint skill' },
        { field: 'adapter', adapter: 'claude-code', config: { permission: { bash: 'ask' } } },
      ],
    })
    if (!result.ok) expect.unreachable()
    const desc = result.manifest.skills?.lint as { adapters?: Record<string, unknown> }
    expect(desc.adapters?.['claude-code']).toEqual({ permission: { bash: 'ask' } })
  })
})

describe('applyModify — update', () => {
  test('sets a description on an existing asset', () => {
    const result = applyModify(baseManifest(), {
      kind: 'update',
      target: 'skills',
      name: 'greet',
      mutations: [{ field: 'description', value: 'Updated' }],
    })
    if (!result.ok) expect.unreachable()
    expect(result.manifest.skills?.greet?.description).toBe('Updated')
    expect(result.fileOps).toEqual([])
  })

  test('rejects updating a missing asset', () => {
    const result = applyModify(baseManifest(), {
      kind: 'update',
      target: 'skills',
      name: 'nope',
      mutations: [{ field: 'description', value: 'x' }],
    })
    if (result.ok) expect.unreachable()
    expect(result.error.reason).toBe('asset-not-found')
  })

  test('replaces an adapter block wholesale', () => {
    const manifest = baseManifest({
      skills: { greet: { description: 'd', adapters: { 'claude-code': { old: true } } } },
    })
    const result = applyModify(manifest, {
      kind: 'update',
      target: 'skills',
      name: 'greet',
      mutations: [{ field: 'adapter', adapter: 'claude-code', config: { fresh: 1 } }],
    })
    if (!result.ok) expect.unreachable()
    const desc = result.manifest.skills?.greet as { adapters?: Record<string, unknown> }
    expect(desc.adapters?.['claude-code']).toEqual({ fresh: 1 })
  })

  test('removes an adapter block, dropping the empty adapters object', () => {
    const manifest = baseManifest({
      skills: { greet: { description: 'd', adapters: { opencode: { a: 1 } } } },
    })
    const result = applyModify(manifest, {
      kind: 'update',
      target: 'skills',
      name: 'greet',
      mutations: [{ field: 'remove-adapter', adapter: 'opencode' }],
    })
    if (!result.ok) expect.unreachable()
    const desc = result.manifest.skills?.greet as { adapters?: Record<string, unknown> }
    expect(desc.adapters).toBeUndefined()
  })

  test('rejects removing an adapter that is not present', () => {
    const result = applyModify(baseManifest(), {
      kind: 'update',
      target: 'skills',
      name: 'greet',
      mutations: [{ field: 'remove-adapter', adapter: 'ghost' }],
    })
    if (result.ok) expect.unreachable()
    if (result.error.reason !== 'adapter-not-found') expect.unreachable()
    expect(result.error.adapter).toBe('ghost')
    expect(result.error.name).toBe('greet')
  })
})

describe('applyModify — rename', () => {
  test('renames an asset and emits a move file op', () => {
    const result = applyModify(baseManifest(), {
      kind: 'rename',
      target: 'skills',
      name: 'greet',
      to: 'welcome',
      mutations: [],
    })
    if (!result.ok) expect.unreachable()
    expect(result.manifest.skills?.welcome).toBeDefined()
    expect(result.manifest.skills?.greet).toBeUndefined()
    expect(result.fileOps).toEqual([
      { op: 'move', target: 'skills', from: 'skills/greet/SKILL.md', to: 'skills/welcome/SKILL.md' },
    ])
  })

  test('rejects renaming onto an existing name', () => {
    const manifest = baseManifest({
      skills: { greet: { description: 'a' }, welcome: { description: 'b' } },
    })
    const result = applyModify(manifest, {
      kind: 'rename',
      target: 'skills',
      name: 'greet',
      to: 'welcome',
      mutations: [],
    })
    if (result.ok) expect.unreachable()
    expect(result.error.reason).toBe('rename-target-exists')
  })
})

describe('applyModify — remove', () => {
  test('removes an asset, deletes its file, and drops the empty section', () => {
    const result = applyModify(
      baseManifest({ skills: { greet: { description: 'd' } }, agents: { a: { description: 'x' } } }),
      {
        kind: 'remove',
        target: 'skills',
        name: 'greet',
      },
    )
    if (!result.ok) expect.unreachable()
    expect(result.manifest.skills).toBeUndefined()
    expect(result.fileOps).toEqual([{ op: 'delete', target: 'skills', name: 'greet' }])
  })

  test('rejects removing a missing asset', () => {
    const result = applyModify(baseManifest(), { kind: 'remove', target: 'agents', name: 'nope' })
    if (result.ok) expect.unreachable()
    expect(result.error.reason).toBe('asset-not-found')
  })
})

describe('applyModify — set-facet-meta', () => {
  test('sets version and description', () => {
    const result = applyModify(baseManifest(), {
      kind: 'set-facet-meta',
      fields: { version: '1.2.3', description: 'New desc' },
    })
    if (!result.ok) expect.unreachable()
    expect(result.manifest.version).toBe('1.2.3')
    expect(result.manifest.description).toBe('New desc')
  })

  test('private true sets the key; private false removes it', () => {
    const set = applyModify(baseManifest(), { kind: 'set-facet-meta', fields: { private: true } })
    if (!set.ok) expect.unreachable()
    expect(set.manifest.private).toBe(true)

    const unset = applyModify(baseManifest({ private: true } as Partial<FacetManifest>), {
      kind: 'set-facet-meta',
      fields: { private: false },
    })
    if (!unset.ok) expect.unreachable()
    expect(unset.manifest.private).toBeUndefined()
  })
})

describe('applyModify — manifest re-validation', () => {
  test('rejects a mutation that would produce an invalid manifest', () => {
    // Renaming the only skill to an invalid asset name would fail schema validation.
    const result: ReturnType<typeof applyModify> = applyModify(baseManifest(), {
      kind: 'set-facet-meta',
      fields: { name: 'x' }, // too short — facet name must be ≥2 chars
    } as ModifyOp)
    if (result.ok) expect.unreachable()
    expect(result.error.reason).toBe('manifest-invalid')
  })

  test('does not mutate the input manifest', () => {
    const input = baseManifest()
    applyModify(input, {
      kind: 'update',
      target: 'skills',
      name: 'greet',
      mutations: [{ field: 'description', value: 'z' }],
    })
    expect(input.skills?.greet?.description).toBe('A greeting skill')
  })
})
