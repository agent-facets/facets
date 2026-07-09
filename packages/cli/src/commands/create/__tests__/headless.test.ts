import { describe, expect, test } from 'bun:test'
import { decideCreate } from '../headless.ts'

describe('decideCreate — mode selection', () => {
  test('no content flags → wizard mode', () => {
    expect(decideCreate({}).mode).toBe('wizard')
    // Presentation-only flags do not trigger headless.
    expect(decideCreate({ force: true, json: true }).mode).toBe('wizard')
  })

  test('any content flag → headless (or error)', () => {
    expect(decideCreate({ name: 'my-facet', skill: ['greet'] }).mode).toBe('headless')
    // A content flag with missing requirements is an error, not wizard.
    expect(decideCreate({ skill: ['greet'] }).mode).toBe('error')
  })
})

describe('decideCreate — headless validation', () => {
  test('builds ScaffoldOptions with defaults', () => {
    const d = decideCreate({ name: 'my-facet', skill: ['greet'], agent: ['helper'] })
    if (d.mode !== 'headless') expect.unreachable()
    expect(d.options).toEqual({
      name: 'my-facet',
      version: '0.0.0',
      description: '',
      skills: ['greet'],
      agents: ['helper'],
      commands: [],
    })
  })

  test('honors version, description, and private', () => {
    const d = decideCreate({
      name: 'my-facet',
      version: '1.2.3',
      description: 'desc',
      private: true,
      command: ['run'],
    })
    if (d.mode !== 'headless') expect.unreachable()
    expect(d.options.version).toBe('1.2.3')
    expect(d.options.description).toBe('desc')
    expect(d.options.private).toBe(true)
    expect(d.options.commands).toEqual(['run'])
  })

  test('missing --name is an error', () => {
    const d = decideCreate({ skill: ['greet'] })
    if (d.mode !== 'error') expect.unreachable()
    expect(d.error.what).toContain('missing --name')
  })

  test('invalid facet name is an error', () => {
    const d = decideCreate({ name: 'x', skill: ['greet'] })
    if (d.mode !== 'error') expect.unreachable()
    expect(d.error.what).toContain('invalid facet name')
  })

  test('invalid semver version is an error', () => {
    const d = decideCreate({ name: 'my-facet', version: 'not-semver', skill: ['greet'] })
    if (d.mode !== 'error') expect.unreachable()
    expect(d.error.what).toContain('invalid --version')
  })

  test('invalid kebab asset name is an error', () => {
    const d = decideCreate({ name: 'my-facet', skill: ['Not Kebab'] })
    if (d.mode !== 'error') expect.unreachable()
    expect(d.error.what).toContain('invalid skill name')
  })

  test('no assets is an error', () => {
    const d = decideCreate({ name: 'my-facet' })
    if (d.mode !== 'error') expect.unreachable()
    expect(d.error.what).toContain('no assets to scaffold')
  })
})
