import { afterAll, afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import { allCommandNames, commands, resolveCommand } from '../../commands.ts'
import { printCommandHelp, printGlobalHelp } from '../../help.ts'
import * as selfUpdateModule from '../../self-update/index.ts'
import { findClosestCommand } from '../../suggest.ts'
import { selfUpdateCommand } from '../self-update.ts'

// Spy on the orchestrator so the command's run() can be tested without
// hitting detection / network / spawn.
type RunSelfUpdate = typeof selfUpdateModule.runSelfUpdate
const runSelfUpdateSpy = spyOn(selfUpdateModule, 'runSelfUpdate') as unknown as Mock<RunSelfUpdate>

beforeEach(() => {
  runSelfUpdateSpy.mockClear()
  runSelfUpdateSpy.mockImplementation(async () => 0)
})

afterEach(() => {
  runSelfUpdateSpy.mockReset()
})

afterAll(() => {
  runSelfUpdateSpy.mockRestore()
})

// ─── Command registration ────────────────────────────────────────────────

describe('self-update command registration', () => {
  test('self-update is registered in the command map', () => {
    expect(commands['self-update']).toBe(selfUpdateCommand)
  })

  test('self-upgrade is NOT a separate map entry — it is an alias', () => {
    // Aliases shouldn't pollute the canonical map; resolution is via
    // `resolveCommand` instead.
    expect(commands['self-upgrade']).toBeUndefined()
  })

  test('selfUpdateCommand declares self-upgrade as an alias', () => {
    expect(selfUpdateCommand.aliases).toContain('self-upgrade')
  })

  test('resolveCommand resolves the canonical name', () => {
    expect(resolveCommand(commands, 'self-update')).toBe(selfUpdateCommand)
  })

  test('resolveCommand resolves the alias to the same object', () => {
    expect(resolveCommand(commands, 'self-upgrade')).toBe(selfUpdateCommand)
  })

  test('resolveCommand returns undefined for unknown names', () => {
    expect(resolveCommand(commands, 'nope-not-a-command')).toBeUndefined()
  })

  test('allCommandNames includes both the canonical name and the alias', () => {
    const names = allCommandNames(commands)
    expect(names).toContain('self-update')
    expect(names).toContain('self-upgrade')
  })

  test('typo of the alias surfaces the alias as a suggestion', () => {
    // findClosestCommand sees the flattened name list (canonical + aliases),
    // so a typo of `self-upgrade` suggests `self-upgrade` directly rather
    // than `self-update`.
    expect(findClosestCommand('self-upgrad', allCommandNames(commands))).toBe('self-upgrade')
  })
})

// ─── Flag forwarding ─────────────────────────────────────────────────────

describe('selfUpdateCommand.run flag forwarding', () => {
  test('no flags → targetVersion undefined, dryRun false', async () => {
    await selfUpdateCommand.run([], {})
    expect(runSelfUpdateSpy).toHaveBeenCalledWith({ targetVersion: undefined, dryRun: false })
  })

  test('--version <v> forwards as targetVersion', async () => {
    await selfUpdateCommand.run([], { version: '0.6.0' })
    expect(runSelfUpdateSpy).toHaveBeenCalledWith({ targetVersion: '0.6.0', dryRun: false })
  })

  test('--dry-run forwards as dryRun: true', async () => {
    await selfUpdateCommand.run([], { 'dry-run': true })
    expect(runSelfUpdateSpy).toHaveBeenCalledWith({ targetVersion: undefined, dryRun: true })
  })

  test('--version + --dry-run forward together', async () => {
    await selfUpdateCommand.run([], { version: '0.5.3', 'dry-run': true })
    expect(runSelfUpdateSpy).toHaveBeenCalledWith({ targetVersion: '0.5.3', dryRun: true })
  })

  test('empty --version is treated as omitted', async () => {
    await selfUpdateCommand.run([], { version: '' })
    expect(runSelfUpdateSpy).toHaveBeenCalledWith({ targetVersion: undefined, dryRun: false })
  })

  test('non-string version flag is ignored', async () => {
    // Runtime defense — should not happen with the parser we use, but the
    // type narrowing in run() should swallow it.
    await selfUpdateCommand.run([], { version: 42 })
    expect(runSelfUpdateSpy).toHaveBeenCalledWith({ targetVersion: undefined, dryRun: false })
  })

  test('returns the orchestrator exit code', async () => {
    runSelfUpdateSpy.mockImplementation(async () => 2)
    expect(await selfUpdateCommand.run([], {})).toBe(2)
  })
})

// ─── Help rendering ──────────────────────────────────────────────────────

/** Capture console.log output during a synchronous body. */
function captureLog(fn: () => void): string {
  const original = console.log
  let captured = ''
  console.log = (...parts: unknown[]) => {
    captured += `${parts.join(' ')}\n`
  }
  try {
    fn()
  } finally {
    console.log = original
  }
  return captured
}

describe('global help rendering', () => {
  test('lists self-update with self-upgrade as a comma-joined alias', () => {
    const out = captureLog(() => {
      printGlobalHelp(commands)
    })
    // Both names appear on the same listing line.
    expect(out).toMatch(/self-update,\s*self-upgrade\s+Update the facet CLI/)
  })

  test('does not render self-update twice (no duplication)', () => {
    const out = captureLog(() => {
      printGlobalHelp(commands)
    })
    // The canonical name appears once on the listing line. We allow for
    // potential occurrences elsewhere (e.g., in the title), so we count
    // matches on the comma-joined label specifically.
    const labelMatches = out.match(/self-update,\s*self-upgrade/g) ?? []
    expect(labelMatches).toHaveLength(1)
  })
})

describe('per-command help rendering', () => {
  test('shows the canonical name in usage', () => {
    const out = captureLog(() => {
      printCommandHelp(selfUpdateCommand)
    })
    expect(out).toContain('Usage: facet self-update')
  })

  test('lists --version and --dry-run', () => {
    const out = captureLog(() => {
      printCommandHelp(selfUpdateCommand)
    })
    expect(out).toMatch(/--version\s+Pin to a specific version/)
    expect(out).toMatch(/--dry-run\s+Print the plan/)
    expect(out).toMatch(/--help\s+Show help/)
  })

  test('rendering via the alias resolution still shows canonical name', () => {
    // Resolved by alias, but printCommandHelp reads command.name (canonical).
    const cmd = resolveCommand(commands, 'self-upgrade')
    expect(cmd).toBeDefined()
    if (!cmd) return
    const out = captureLog(() => {
      printCommandHelp(cmd)
    })
    expect(out).toContain('Usage: facet self-update')
    // Critically, NOT "Usage: facet self-upgrade".
    expect(out).not.toContain('Usage: facet self-upgrade')
  })
})
