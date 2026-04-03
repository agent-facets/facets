import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

const CLI_PATH = resolve(import.meta.dir, '../../dist/facet')
const COMMAND_NAMES = ['add', 'build', 'create', 'edit', 'info', 'install', 'list', 'publish', 'remove', 'upgrade']
const STUB_COMMAND_NAMES = ['add', 'info', 'install', 'list', 'publish', 'remove', 'upgrade']

type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
}

async function runCli(...args: string[]): Promise<ExecResult> {
  const proc = Bun.spawn([CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

// --- Help ---

describe('CLI — help', () => {
  test('--help prints command list to stdout and exits 0', async () => {
    const result = await runCli('--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: facet <command>')
    for (const cmd of COMMAND_NAMES) {
      expect(result.stdout).toContain(cmd)
    }
    expect(result.stderr).toBe('')
  })

  test('help command produces same output as --help', async () => {
    const helpFlag = await runCli('--help')
    const helpCommand = await runCli('help')
    expect(helpCommand.exitCode).toBe(0)
    expect(helpCommand.stdout).toBe(helpFlag.stdout)
    expect(helpCommand.stderr).toBe('')
  })
})

// --- Version ---

describe('CLI — version', () => {
  test('--version prints version matching package.json and exits 0', async () => {
    const pkg = await Bun.file(resolve(import.meta.dir, '../../package.json')).json()
    const result = await runCli('--version')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(pkg.version)
    expect(result.stderr).toBe('')
  })
})

// --- Bare invocation ---

describe('CLI — bare invocation', () => {
  test('no arguments prints help and exits 0', async () => {
    const helpResult = await runCli('--help')
    const bareResult = await runCli()
    expect(bareResult.exitCode).toBe(0)
    expect(bareResult.stdout).toBe(helpResult.stdout)
    expect(bareResult.stderr).toBe('')
  })
})

// --- Stub commands ---

describe('CLI — stub commands', () => {
  test.each(STUB_COMMAND_NAMES)('"%s" prints not yet implemented with command name and exits 0', async (cmd) => {
    const result = await runCli(cmd)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(cmd)
    expect(result.stdout).toContain('not yet implemented')
    expect(result.stderr).toBe('')
  })
})

// --- Edit command dispatch ---

describe('CLI — edit command', () => {
  test('edit with no manifest prints error and exits 1', async () => {
    const result = await runCli('edit', import.meta.dir)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Manifest is invalid')
  })
})

// --- Unknown commands ---

describe('CLI — unknown commands', () => {
  test('unknown command prints error to stderr and exits 1', async () => {
    const result = await runCli('xyzzy')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command "xyzzy"')
    expect(result.stdout).toBe('')
  })

  test('unknown command with close match includes "did you mean?" suggestion', async () => {
    const result = await runCli('bild')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command "bild"')
    expect(result.stderr).toContain('Did you mean "build"')
    expect(result.stdout).toBe('')
  })

  test('unknown command with no close match does not include suggestion', async () => {
    const result = await runCli('xyzzy')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command "xyzzy"')
    expect(result.stderr).not.toContain('Did you mean')
    expect(result.stdout).toBe('')
  })
})

// --- Per-command help ---

describe('CLI — per-command help', () => {
  test('<command> --help prints command-specific help and exits 0', async () => {
    const result = await runCli('build', '--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('facet build')
    expect(result.stdout).toContain('Build a facet from the current directory')
    expect(result.stderr).toBe('')
  })
})

// --- Unexpected error ---

describe('CLI — unexpected error', () => {
  test('unexpected error exits with code 2', async () => {
    // This test runs against source (not compiled binary) because it needs to
    // monkey-patch the command registry to inject a crashing command.
    const script = `
      import { commands } from '${resolve(import.meta.dir, '../commands.ts')}'
      import { run } from '${resolve(import.meta.dir, '../run.ts')}'
      commands['crash'] = {
        name: 'crash',
        description: 'Throws an error',
        run: async () => { throw new Error('boom') },
      }
      try {
        const code = await run(['crash'])
        process.exit(code)
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'An unexpected error occurred.')
        process.exit(2)
      }
    `
    const proc = Bun.spawn(['bun', '--eval', script], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    expect(exitCode).toBe(2)
    expect(stderr.trim()).toContain('boom')
  })
})
