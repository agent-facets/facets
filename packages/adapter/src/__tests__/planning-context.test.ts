import { describe, expect, test } from 'bun:test'
import { type CapabilityDeclarations, checkPlanningContext, isAbsoluteLocation } from '../planning-context.ts'

const BOTH: CapabilityDeclarations = { supportedScopes: ['project', 'user'], locationEnvironment: ['CODEX_HOME'] }

function failure(value: unknown, declarations: CapabilityDeclarations = BOTH) {
  const result = checkPlanningContext(value, declarations)
  if (result.ok) expect.unreachable()
  return result.failure
}

describe('isAbsoluteLocation', () => {
  test.each(['/home/alice', 'C:\\Users\\alice', 'c:/Users/alice', '\\\\server\\share\\alice'])('accepts %s', (path) => {
    expect(isAbsoluteLocation(path)).toBe(true)
  })

  test.each(['', 'alice', './alice', '~/alice', 'C:alice', '\\alice', '/home/a\0lice'])('rejects %j', (path) => {
    expect(isAbsoluteLocation(path)).toBe(false)
  })
})

describe('checkPlanningContext', () => {
  test('a user context is accepted with no project root', () => {
    const result = checkPlanningContext(
      { target: { scope: 'user' }, homeDirectory: '/home/alice', environment: {} },
      BOTH,
    )
    if (!result.ok) expect.unreachable()
    expect(result.context).toEqual({ target: { scope: 'user' }, homeDirectory: '/home/alice', environment: {} })
    expect(Object.hasOwn(result.context.target, 'projectRoot')).toBe(false)
  })

  test('a supported Windows home is accepted on any platform', () => {
    const result = checkPlanningContext(
      { target: { scope: 'user' }, homeDirectory: 'C:\\Users\\alice', environment: {} },
      BOTH,
    )
    if (!result.ok) expect.unreachable()
    expect(result.context.homeDirectory).toBe('C:\\Users\\alice')
  })

  test('a non-string scope is malformed, not unsupported', () => {
    expect(failure({ target: { scope: 7 }, homeDirectory: '/h', environment: {} })).toEqual({
      code: 'invalid-target',
      field: 'context.target.scope',
      reason: 'must be "project" or "user"',
    })
  })

  test('an unknown scope string is unsupported', () => {
    expect(failure({ target: { scope: 'global' }, homeDirectory: '/h', environment: {} })).toEqual({
      code: 'unsupported-scope',
      scope: 'global',
      supportedScopes: ['project', 'user'],
    })
  })

  test('a relative project root is malformed', () => {
    const result = failure({ target: { scope: 'project', projectRoot: 'app' }, homeDirectory: '/h', environment: {} })
    if (result.code !== 'invalid-target') expect.unreachable()
    expect(result.field).toBe('context.target.projectRoot')
  })

  test('a non-object environment is malformed', () => {
    const result = failure({ target: { scope: 'user' }, homeDirectory: '/h', environment: null })
    if (result.code !== 'invalid-target') expect.unreachable()
    expect(result.field).toBe('context.environment')
  })

  test('a non-string declared value is malformed at its own key', () => {
    const result = failure({ target: { scope: 'user' }, homeDirectory: '/h', environment: { CODEX_HOME: 3 } })
    if (result.code !== 'invalid-target') expect.unreachable()
    expect(result.field).toBe('context.environment.CODEX_HOME')
  })

  test('an undeclared value is neither validated nor passed on', () => {
    const result = checkPlanningContext(
      { target: { scope: 'user' }, homeDirectory: '/h', environment: { OTHER: 3, CODEX_HOME: '/opt/codex' } },
      BOTH,
    )
    if (!result.ok) expect.unreachable()
    expect(result.context.environment).toEqual({ CODEX_HOME: '/opt/codex' })
  })

  test('an inherited environment value is not mistaken for a supplied one', () => {
    const environment = Object.create({ CODEX_HOME: '/inherited' })
    const result = checkPlanningContext({ target: { scope: 'user' }, homeDirectory: '/h', environment }, BOTH)
    if (!result.ok) expect.unreachable()
    expect(result.context.environment).toEqual({})
  })

  test('the returned context is a frozen copy', () => {
    const supplied = {
      target: { scope: 'project', projectRoot: '/work/app' },
      homeDirectory: '/home/alice',
      environment: { CODEX_HOME: '/opt/codex' },
    }
    const result = checkPlanningContext(supplied, BOTH)
    if (!result.ok) expect.unreachable()
    expect(result.context).not.toBe(supplied)
    expect(Object.isFrozen(result.context)).toBe(true)
    expect(Object.isFrozen(result.context.target)).toBe(true)
    expect(Object.isFrozen(result.context.environment)).toBe(true)

    supplied.environment.CODEX_HOME = '/changed'
    expect(result.context.environment.CODEX_HOME).toBe('/opt/codex')
  })

  test('a throwing getter is reported as an unreadable context', () => {
    const value = {
      get target(): never {
        throw new Error('boom')
      },
    }
    expect(failure(value)).toEqual({ code: 'invalid-target', field: 'context', reason: 'could not be read' })
  })

  test('the declared scope set is consulted after the shape is valid', () => {
    expect(
      failure(
        { target: { scope: 'user' }, homeDirectory: '/h', environment: {} },
        { supportedScopes: ['project'], locationEnvironment: [] },
      ),
    ).toEqual({ code: 'unsupported-scope', scope: 'user', supportedScopes: ['project'] })
  })
})
