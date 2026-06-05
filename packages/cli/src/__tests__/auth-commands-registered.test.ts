import { describe, expect, test } from 'bun:test'
import { commands, resolveCommand } from '../commands.ts'

// Registration is asserted here as a unit; the global-help *listing* of
// these commands is covered by the e2e help test (which runs the real
// binary, where `printGlobalHelp`'s `console.log` reaches real stdout).
describe('login / whoami / logout registration', () => {
  test.each(['login', 'whoami', 'logout'])('%s is registered, implemented, and shown in help', (name) => {
    const cmd = resolveCommand(commands, name)
    expect(cmd).toBeDefined()
    expect(cmd?.name).toBe(name)
    // `implemented: true` is what makes a command appear in the global
    // help listing (stubs are hidden), so this also guards visibility.
    expect(cmd?.implemented).toBe(true)
  })

  test('none of the three declare aliases', () => {
    for (const name of ['login', 'whoami', 'logout']) {
      const cmd = resolveCommand(commands, name)
      expect(cmd?.aliases).toBeUndefined()
    }
  })
})
