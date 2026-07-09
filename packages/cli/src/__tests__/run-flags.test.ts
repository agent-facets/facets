import { describe, expect, test } from 'bun:test'
import type { Command } from '../commands.ts'
import { run } from '../run.ts'

/**
 * Build a one-command registry whose `run` captures the positional args and
 * flags it received, so we can assert how `run()` parses argv.
 */
function captureRegistry(flags?: Command['flags']): {
  registry: Record<string, Command>
  captured: () => { args: string[]; flags: Record<string, unknown> } | undefined
} {
  let seen: { args: string[]; flags: Record<string, unknown> } | undefined
  const registry: Record<string, Command> = {
    demo: {
      name: 'demo',
      description: 'test command',
      implemented: true,
      ...(flags ? { flags } : {}),
      run: async (args, f) => {
        seen = { args, flags: f }
        return 0
      },
    },
  }
  return { registry, captured: () => seen }
}

describe('run — array flags', () => {
  test('repeated array flag collects into string[]', async () => {
    const { registry, captured } = captureRegistry({
      skill: { type: 'array', description: 'skills' },
    })
    await run(['demo', '--skill', 'a', '--skill', 'b'], registry)
    expect(captured()?.flags.skill).toEqual(['a', 'b'])
  })

  test('single array flag is normalized to a one-element array', async () => {
    const { registry, captured } = captureRegistry({
      skill: { type: 'array', description: 'skills' },
    })
    await run(['demo', '--skill', 'only'], registry)
    expect(captured()?.flags.skill).toEqual(['only'])
  })
})

describe('run — undeclared flag passthrough', () => {
  test('open-ended flags (used by modify) reach the command', async () => {
    const { registry, captured } = captureRegistry()
    await run(['demo', 'skill', 'greet', '--adapter-claude-code', '{"a":1}'], registry)
    expect(captured()?.flags['adapter-claude-code']).toBe('{"a":1}')
  })
})

describe('run — global --version is positional-aware', () => {
  test('--version before the command prints the CLI version and skips the command', async () => {
    const { registry, captured } = captureRegistry()
    const code = await run(['--version'], registry)
    expect(code).toBe(0)
    // No command ran.
    expect(captured()).toBeUndefined()
  })

  test('--version AFTER a command is forwarded to the command, not intercepted', async () => {
    const { registry, captured } = captureRegistry({
      version: { type: 'string', description: 'set version' },
    })
    const code = await run(['demo', 'facet', '--version', '1.2.3'], registry)
    expect(code).toBe(0)
    // The command ran and saw the version flag as its own.
    expect(captured()?.flags.version).toBe('1.2.3')
  })
})
