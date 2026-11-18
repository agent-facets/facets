import { describe, expect, test } from 'bun:test'
import { type AnyCommand, commands, defineCommand } from '../commands.ts'
import { commandHelpData, commandOptions, printCommandHelp } from '../help.ts'
import { parseCommandFlags } from '../parse-flags.ts'
import { captureLog } from './helpers/capture-log.ts'

const registry = [...new Set(Object.values(commands))] as AnyCommand[]

describe('compile-time flag guarantees', () => {
  test('declarations need help text and placeholders, and handlers read only declared flags', () => {
    defineCommand({
      name: 'typed',
      description: 'typed',
      flags: {
        // @ts-expect-error a flag must document itself
        quiet: { type: 'boolean' },
        // @ts-expect-error a value flag must name its placeholder
        tag: { type: 'string', description: 'tag' },
      },
      run: async () => 0,
      runJson: async () => ({ ok: true, data: null }),
    })
    defineCommand({
      name: 'typed',
      description: 'typed',
      flags: { verbose: { type: 'boolean', description: 'verbose' } },
      run: async (_args, flags) => {
        const known: boolean | undefined = flags.verbose
        // @ts-expect-error an undeclared flag cannot be read
        const unknown = flags.verbos
        return known === unknown ? 0 : 1
      },
      runJson: async () => ({ ok: true, data: null }),
    })
  })
})

describe('every registered command', () => {
  for (const command of registry) {
    test(`${command.name}: every option documents itself`, () => {
      for (const option of commandOptions(command)) {
        expect([option.name, option.description.trim().length > 0]).toEqual([option.name, true])
      }
    })

    test(`${command.name}: no two spellings collide`, () => {
      const spellings = commandOptions(command).map((option) => option.name)
      for (const option of commandOptions(command)) if (option.short) spellings.push(option.short)
      spellings.push('json', 'help')
      expect(spellings.length).toBe(new Set(spellings).size)
    })

    test(`${command.name}: both help formats list every accepted spelling`, () => {
      const text = captureLog(() => printCommandHelp(command))
      const json = commandHelpData(command).options.map((option) => option.name)
      for (const option of commandOptions(command)) {
        expect(text).toContain(`--${option.name}`)
        expect(json).toContain(option.name)
      }
    })

    test(`${command.name}: every listed non-pattern spelling is accepted by the parser`, () => {
      for (const option of commandOptions(command)) {
        if (option.pattern) continue
        const tokens = option.valueName !== undefined ? [`--${option.name}`, 'value'] : [`--${option.name}`]
        expect([option.name, parseCommandFlags(command, tokens).ok]).toEqual([option.name, true])
      }
    })
  }
})
