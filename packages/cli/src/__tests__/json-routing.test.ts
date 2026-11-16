import { describe, expect, test } from 'bun:test'
import { type Command, commands } from '../commands.ts'
import { run } from '../run.ts'

async function invoke(argv: string[], registry: Record<string, Command>) {
  let output = ''
  const original = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString()
    return true
  }) as typeof process.stdout.write
  try {
    const exitCode = await run(argv, registry)
    return { exitCode, document: JSON.parse(output) as Record<string, unknown> }
  } finally {
    process.stdout.write = original
  }
}

const demo: Command = {
  name: 'demo',
  aliases: ['d'],
  description: 'Example',
  implemented: true,
  flags: { version: { type: 'string', description: 'Set version' } },
  run: async () => {
    throw new Error('human handler must not run')
  },
  runJson: async (args, flags) => ({ ok: true, data: { args, flags } }),
}

describe('JSON routing', () => {
  test('every registered command has an explicit JSON handler', () => {
    for (const command of Object.values(commands)) {
      expect([command.name, typeof command.runJson]).toEqual([command.name, 'function'])
    }
  })

  test('every registered command exposes structured JSON help', async () => {
    for (const command of Object.values(commands)) {
      const result = await invoke(['--json', command.name, '--help'], commands)
      expect(result.exitCode).toBe(0)
      expect(result.document).toMatchObject({ command: 'help', ok: true, data: { name: command.name } })
    }
  })

  test('malformed JSON flags fail as JSON rather than selecting a human flow', async () => {
    const result = await invoke(['edit', '--json=maybe', '--help'], commands)
    expect(result.exitCode).toBe(1)
    expect(result.document).toMatchObject({ command: 'edit', error: { code: 'INVALID_ARGUMENTS' } })
  })

  test('repeated completion flags are rejected before login starts', async () => {
    const result = await invoke(['login', '--complete', 'first', '--complete', 'second', '--json'], commands)
    expect(result.exitCode).toBe(1)
    expect(result.document).toMatchObject({ command: 'login', error: { code: 'INVALID_ARGUMENTS' } })
  })

  test('adapter help describes its subcommands', async () => {
    const result = await invoke(['adapter', '--help', '--json'], commands)
    expect(result.document).toMatchObject({
      data: { subcommands: [{ name: 'add' }, { name: 'list' }, { name: 'remove' }] },
    })
  })

  test('edit refuses JSON execution without invoking its human wizard', async () => {
    const result = await invoke(['edit', '--json'], commands)
    expect(result.exitCode).toBe(1)
    expect(result.document).toMatchObject({ command: 'edit', error: { code: 'INTERACTION_REQUIRED' } })
  })

  test('accepts JSON before the command and resolves aliases', async () => {
    const result = await invoke(['--json', 'd', '--version', '1.2.3'], { demo })
    expect(result.exitCode).toBe(0)
    expect(result.document).toMatchObject({
      schemaVersion: '3',
      command: 'demo',
      ok: true,
      data: { flags: { version: '1.2.3', json: true } },
      warnings: [],
    })
  })

  test('preserves arguments after the separator', async () => {
    const result = await invoke(['demo', '--json', '--', '--version', '--json'], { demo })
    expect(result.document.data).toMatchObject({ args: ['--version', '--json'] })
  })

  test('returns structured help and unknown-command failures', async () => {
    const help = await invoke(['--json', 'help', 'demo'], { demo })
    expect(help.document).toMatchObject({ command: 'help', ok: true, data: { name: 'demo' } })
    const unknown = await invoke(['--json', 'missing'], { demo })
    expect(unknown.exitCode).toBe(1)
    expect(unknown.document).toMatchObject({ command: 'missing', error: { code: 'UNKNOWN_COMMAND' } })
  })

  test('--json before `--` selects JSON; operands after it reach the handler', async () => {
    const result = await invoke(['demo', 'cowsay', '--json', '--', '--help'], { demo })
    expect(result.document).toMatchObject({ ok: true, data: { args: ['cowsay', '--help'] } })
  })

  test('--json after `--` is an operand, not an output mode', async () => {
    let seen: string[] | undefined
    const human: Command = {
      ...demo,
      run: async (args) => {
        seen = args
        return 0
      },
    }
    const code = await run(['demo', 'cowsay', '--', '--json'], { demo: human })
    expect(code).toBe(0)
    expect(seen).toEqual(['cowsay', '--json'])
  })

  test('hidden characters in strings are written as escapes and parse back exactly', async () => {
    // Built from code points: the formatter rewrites `\u` escapes for these into invisible literals.
    const hostile = ['a', 0x1b, '[2Jb', 0x202e, 'c', 0xe0041, 'd', 0x200b, 'e', 0x7f, 'f']
      .map((part) => (typeof part === 'number' ? String.fromCodePoint(part) : part))
      .join('')
    let raw = ''
    const original = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      raw += chunk.toString()
      return true
    }) as typeof process.stdout.write
    try {
      await run(['demo', '--json'], { demo: { ...demo, runJson: async () => ({ ok: true, data: { text: hostile } }) } })
    } finally {
      process.stdout.write = original
    }
    for (const code of [0x1b, 0x202e, 0xe0041, 0x200b, 0x7f]) {
      expect(raw).not.toContain(String.fromCodePoint(code))
    }
    expect(raw).toContain('\\u202e')
    expect(raw).toContain('\\udb40\\udc41')
    expect(JSON.parse(raw).data.text).toBe(hostile)
  })

  test('sanitizes unexpected exceptions', async () => {
    const result = await invoke(['demo', '--json'], {
      demo: {
        ...demo,
        runJson: async () => {
          throw new Error('secret')
        },
      },
    })
    expect(result.exitCode).toBe(2)
    expect(result.document).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
    expect(JSON.stringify(result.document)).not.toContain('secret')
  })
})
