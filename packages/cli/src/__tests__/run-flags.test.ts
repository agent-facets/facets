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

  // Declaring short aliases changes how the parser is configured, so the
  // open-ended flags `modify` depends on have to keep working alongside them.
  test('a command that declares short aliases still forwards open-ended flags', async () => {
    const { registry, captured } = captureRegistry({
      interactive: { type: 'boolean', short: 'i', description: 'interactive' },
    })
    await run(['demo', '--adapter-claude-code', '{"a":1}'], registry)
    expect(captured()?.flags).toEqual({ 'adapter-claude-code': '{"a":1}' })
  })
})

describe('run — declared short aliases', () => {
  const SHORT_FLAGS = {
    interactive: { type: 'boolean', short: 'i', description: 'interactive' },
    latest: { type: 'boolean', short: 'L', description: 'latest' },
  } as const satisfies Command['flags']

  test('-i sets the canonical flag and nothing else', async () => {
    const { registry, captured } = captureRegistry(SHORT_FLAGS)
    await run(['demo', '-i'], registry)
    expect(captured()?.flags).toEqual({ interactive: true })
  })

  test('-L sets the canonical flag and nothing else', async () => {
    const { registry, captured } = captureRegistry(SHORT_FLAGS)
    await run(['demo', '-L'], registry)
    expect(captured()?.flags).toEqual({ latest: true })
  })

  test('the short and long spellings are indistinguishable to the handler', async () => {
    const short = captureRegistry(SHORT_FLAGS)
    await run(['demo', '-i', '-L'], short.registry)
    const long = captureRegistry(SHORT_FLAGS)
    await run(['demo', '--interactive', '--latest'], long.registry)
    expect(short.captured()?.flags).toEqual(long.captured()?.flags ?? {})
  })

  // The parser types a token by the name as typed, before it rewrites
  // aliases. A short boolean that isn't also declared boolean reads the next
  // argument as its value, which would quietly eat a positional.
  test('a short boolean does not consume the following positional', async () => {
    const { registry, captured } = captureRegistry(SHORT_FLAGS)
    await run(['demo', '-i', 'alpha'], registry)
    expect(captured()?.args).toEqual(['alpha'])
    expect(captured()?.flags).toEqual({ interactive: true })
  })

  test('a short string flag keeps its value a string', async () => {
    const { registry, captured } = captureRegistry({
      tag: { type: 'string', short: 't', description: 'tag' },
    })
    await run(['demo', '-t', '1.5'], registry)
    expect(captured()?.flags.tag).toBe('1.5')
  })

  test('a short array flag collects alongside its long form', async () => {
    const { registry, captured } = captureRegistry({
      skill: { type: 'array', short: 's', description: 'skills' },
    })
    await run(['demo', '--skill', 'a', '-s', 'b'], registry)
    expect(captured()?.flags).toEqual({ skill: ['a', 'b'] })
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
