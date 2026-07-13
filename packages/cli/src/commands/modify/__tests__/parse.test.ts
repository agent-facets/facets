import { describe, expect, test } from 'bun:test'
import { parseModifyArgs } from '../parse.ts'

describe('parseModifyArgs — legal operations', () => {
  test('add with description + adapter', () => {
    const r = parseModifyArgs(['skill', 'greet'], {
      add: true,
      description: 'hi',
      'adapter-claude-code': '{"permission":{"bash":"ask"}}',
    })
    if (!r.ok) expect.unreachable()
    if (r.op.kind !== 'add') expect.unreachable()
    expect(r.op.target).toBe('skills')
    expect(r.op.name).toBe('greet')
    expect(r.op.mutations).toContainEqual({ field: 'description', value: 'hi' })
    expect(r.op.mutations).toContainEqual({
      field: 'adapter',
      adapter: 'claude-code',
      config: { permission: { bash: 'ask' } },
    })
  })

  test('bare update with only a description', () => {
    const r = parseModifyArgs(['agent', 'helper'], { description: 'new' })
    if (!r.ok) expect.unreachable()
    expect(r.op.kind).toBe('update')
  })

  test('rename with a valid kebab target', () => {
    const r = parseModifyArgs(['skill', 'greet'], { rename: 'welcome' })
    if (!r.ok) expect.unreachable()
    if (r.op.kind !== 'rename') expect.unreachable()
    expect(r.op.to).toBe('welcome')
  })

  test('add with a digit-start name is accepted (Agent Skills grammar)', () => {
    const r = parseModifyArgs(['skill', '2fa'], { add: true })
    if (!r.ok) expect.unreachable()
    if (r.op.kind !== 'add') expect.unreachable()
    expect(r.op.name).toBe('2fa')
  })

  test('update on a legacy non-kebab name is still allowed', () => {
    // --update/--remove must keep working on existing non-kebab names so users
    // can fix or remove them; only --add and --rename validate the new name.
    const r = parseModifyArgs(['skill', 'Legacy_Name'], { description: 'x' })
    if (!r.ok) expect.unreachable()
    expect(r.op.kind).toBe('update')
  })

  test('remove on a legacy non-kebab name is still allowed', () => {
    const r = parseModifyArgs(['skill', 'Legacy_Name'], { remove: true })
    if (!r.ok) expect.unreachable()
    expect(r.op.kind).toBe('remove')
  })

  test('remove with no mutations', () => {
    const r = parseModifyArgs(['command', 'run'], { remove: true })
    if (!r.ok) expect.unreachable()
    expect(r.op.kind).toBe('remove')
  })

  test('remove-adapter mutation on update', () => {
    const r = parseModifyArgs(['skill', 'greet'], { 'remove-adapter-opencode': true })
    if (!r.ok) expect.unreachable()
    if (r.op.kind !== 'update') expect.unreachable()
    expect(r.op.mutations).toEqual([{ field: 'remove-adapter', adapter: 'opencode' }])
  })

  test('facet metadata set', () => {
    const r = parseModifyArgs(['facet'], { version: '1.0.0', private: true })
    if (!r.ok) expect.unreachable()
    if (r.op.kind !== 'set-facet-meta') expect.unreachable()
    expect(r.op.fields.version).toBe('1.0.0')
    expect(r.op.fields.private).toBe(true)
  })
})

describe('parseModifyArgs — illegal combinations rejected at the boundary', () => {
  test('two lifecycle verbs conflict', () => {
    const r = parseModifyArgs(['skill', 'greet'], { add: true, rename: 'x' })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toBe('conflicting operations')
  })

  test('remove + description is rejected', () => {
    const r = parseModifyArgs(['skill', 'greet'], { remove: true, description: 'x' })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toBe('cannot modify fields while removing')
  })

  test('no verb and no mutation is a no-op error', () => {
    const r = parseModifyArgs(['skill', 'greet'], {})
    if (r.ok) expect.unreachable()
    expect(r.error.what).toBe('no operation specified')
  })

  test('unknown target', () => {
    const r = parseModifyArgs(['widget', 'foo'], { add: true })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('unknown target')
  })

  test('missing asset name', () => {
    const r = parseModifyArgs(['skill'], { add: true })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('missing skill name')
  })

  test('facet-meta flag on an asset target', () => {
    const r = parseModifyArgs(['skill', 'greet'], { version: '1.0.0' })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('--version is not valid')
  })

  test('lifecycle flag on the facet target', () => {
    const r = parseModifyArgs(['facet'], { add: true })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('--add is not valid for the facet target')
  })

  test('invalid rename target', () => {
    const r = parseModifyArgs(['skill', 'greet'], { rename: 'Not Kebab' })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('invalid rename target')
  })

  test('add with an invalid asset name is rejected at the boundary', () => {
    const r = parseModifyArgs(['skill', 'Not Kebab'], { add: true })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('invalid skill name')
  })

  test('adapter JSON that is not an object', () => {
    const r = parseModifyArgs(['skill', 'greet'], { 'adapter-claude': '"a string"' })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('must be a JSON object')
  })

  test('adapter JSON that does not parse', () => {
    const r = parseModifyArgs(['skill', 'greet'], { 'adapter-claude': '{not json' })
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('invalid JSON')
  })

  test('facet with no fields', () => {
    const r = parseModifyArgs(['facet'], {})
    if (r.ok) expect.unreachable()
    expect(r.error.what).toContain('no facet fields')
  })
})
