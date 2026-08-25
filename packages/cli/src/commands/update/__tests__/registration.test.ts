import { describe, expect, test } from 'bun:test'
import { captureLog } from '../../../__tests__/helpers/capture-log.ts'
import { allCommandNames, commands, resolveCommand } from '../../../commands.ts'
import { printCommandHelp, printGlobalHelp } from '../../../help.ts'
import { findClosestCommand } from '../../../suggest.ts'
import { ACCEPT_MCP_FLAG, INSTALL_PIPELINE_FLAGS } from '../../shared/flags.ts'
import { updateCommand } from '../index.ts'

describe('update registration', () => {
  test('update is the canonical name and upgrade is only an alias', () => {
    expect(commands.update).toBe(updateCommand)
    // Not a second registry key: one object, one help page, one behavior.
    expect(commands.upgrade).toBeUndefined()
    expect(updateCommand.aliases).toContain('upgrade')
  })

  test('both names resolve to the same command object', () => {
    expect(resolveCommand(commands, 'update')).toBe(updateCommand)
    expect(resolveCommand(commands, 'upgrade')).toBe(updateCommand)
  })

  test('upgrade is no longer an unimplemented stub', () => {
    expect(updateCommand.implemented).toBe(true)
  })

  test('typo suggestions know both names', () => {
    expect(allCommandNames(commands)).toContain('update')
    expect(allCommandNames(commands)).toContain('upgrade')
    expect(findClosestCommand('upgrad', allCommandNames(commands))).toBe('upgrade')
  })

  test('the shared install-pipeline flags are shared, not copied', () => {
    expect(updateCommand.flags?.verbose).toBe(INSTALL_PIPELINE_FLAGS.verbose)
    expect(updateCommand.flags?.[ACCEPT_MCP_FLAG]).toBe(INSTALL_PIPELINE_FLAGS[ACCEPT_MCP_FLAG])
  })

  test('the flag surface is exactly what the command supports', () => {
    expect(updateCommand.flags?.latest?.short).toBe('L')
    expect(updateCommand.flags?.interactive?.short).toBe('i')
    expect(updateCommand.flags?.['dry-run']).toBeDefined()
    // Reproducing a lockfile is `facet install`'s mode, and it is the
    // opposite of what update does.
    expect(updateCommand.flags?.['frozen-lockfile']).toBeUndefined()
  })
})

describe('update help', () => {
  test('global help lists update with upgrade on one line', () => {
    const out = captureLog(() => {
      printGlobalHelp(commands)
    })
    expect(out).toMatch(/update,\s*upgrade\s+Update the facets/)
    expect(out.match(/update,\s*upgrade/g) ?? []).toHaveLength(1)
  })

  test('per-command help shows both spellings of each short-aliased flag', () => {
    const out = captureLog(() => {
      printCommandHelp(updateCommand)
    })
    expect(out).toMatch(/-L, --latest\s+/)
    expect(out).toMatch(/-i, --interactive\s+/)
    expect(out).toMatch(/--dry-run\s+/)
    expect(out).toMatch(/--verbose\s+/)
    expect(out).toContain(`--${ACCEPT_MCP_FLAG}`)
    expect(out).not.toContain('--frozen-lockfile')
  })

  test('help says which command updates the CLI instead', () => {
    const out = captureLog(() => {
      printCommandHelp(updateCommand)
    })
    expect(out).toContain('self-update')
    expect(out).toContain('facets this project declares')
  })

  test('help invoked through the alias still names the canonical command', () => {
    const command = resolveCommand(commands, 'upgrade')
    if (command === undefined) expect.unreachable()
    const out = captureLog(() => {
      printCommandHelp(command)
    })
    expect(out).toContain('Usage: facet update')
    expect(out).not.toContain('Usage: facet upgrade')
  })
})
