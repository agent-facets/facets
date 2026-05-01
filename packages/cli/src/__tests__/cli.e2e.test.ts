import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const CLI_PATH = resolve(import.meta.dir, '../../dist/facet')

if (!existsSync(CLI_PATH)) {
  throw new Error(
    `[e2e] dist/facet not found at ${CLI_PATH}.\n` +
      `Build the CLI first:\n` +
      `  bun run --cwd packages/cli build\n` +
      `Or run the full check pipeline:\n` +
      `  bun check`,
  )
}
// Commands wired to real implementations — these appear in `facet --help`.
// `self-update` shows in help with `self-upgrade` as a comma-joined alias on
// the same line; we assert the canonical name only here, and the alias
// rendering separately in self-update.e2e.test.ts.
const IMPLEMENTED_COMMAND_NAMES = ['adapter', 'add', 'build', 'create', 'edit', 'install', 'self-update']
// Stubs — invocable (to surface "did you mean…" suggestions) but hidden from
// the global help listing (Adjustment K).
const STUB_COMMAND_NAMES = ['info', 'list', 'publish', 'remove', 'upgrade']

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
  test('--help lists implemented commands and hides stubs', async () => {
    const result = await runCli('--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: facet <command>')
    // Match command names as whole-word rows (e.g., "  install  …") so
    // substrings inside descriptions ("adapter installations") don't false-
    // positive the contains check. The trailing boundary tolerates a comma
    // (when aliases follow, e.g., "  self-update, self-upgrade  …").
    for (const cmd of IMPLEMENTED_COMMAND_NAMES) {
      expect(result.stdout).toMatch(new RegExp(`^\\s+${cmd}[,\\s]`, 'm'))
    }
    for (const cmd of STUB_COMMAND_NAMES) {
      expect(result.stdout).not.toMatch(new RegExp(`^\\s+${cmd}[,\\s]`, 'm'))
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
    expect(result.stderr).toContain('facet.json')
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
  test('unexpected error is thrown by run', async () => {
    const { run } = await import('../run.ts')

    const crashRegistry = {
      crash: {
        name: 'crash',
        description: 'Throws an error',
        run: async (_args: string[], _flags: Record<string, unknown>) => {
          throw new Error('boom')
        },
      },
    }

    await expect(run(['crash'], crashRegistry)).rejects.toThrow('boom')
  })
})

// --- Per-command flags ---

describe('CLI — per-command flags', () => {
  test('create --help shows --force flag and usage', async () => {
    const result = await runCli('create', '--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[directory]')
    expect(result.stdout).toContain('--force')
    expect(result.stdout).toContain('Overwrite existing facet.json')
  })

  test('build --help shows directory usage', async () => {
    const result = await runCli('build', '--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[directory]')
  })

  test('edit --help shows directory usage', async () => {
    const result = await runCli('edit', '--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[directory]')
  })
})

// --- Directory validation ---

describe('CLI — directory validation', () => {
  test('build with non-existent directory errors', async () => {
    const result = await runCli('build', `/tmp/does-not-exist-${Date.now()}`)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('does not exist')
  })

  test('edit with non-existent directory errors', async () => {
    const result = await runCli('edit', `/tmp/does-not-exist-${Date.now()}`)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('does not exist')
  })

  test('build with file instead of directory errors', async () => {
    const result = await runCli('build', import.meta.path)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Expected a directory')
  })
})
