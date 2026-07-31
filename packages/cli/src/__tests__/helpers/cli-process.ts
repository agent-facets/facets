import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** The compiled binary the end-to-end suites drive. */
export const CLI_PATH = resolve(import.meta.dir, '../../../dist/facet')

if (!existsSync(CLI_PATH)) {
  throw new Error(
    `[e2e] dist/facet not found at ${CLI_PATH}.\n` +
      `Build the CLI first:\n` +
      `  bun run --cwd packages/cli build\n` +
      `Or run the full check pipeline:\n` +
      `  bun check`,
  )
}

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface SpawnCliOptions {
  cwd?: string
  /** Merged over `process.env`. */
  env?: Record<string, string>
  /**
   * Closed by default: a command that tried to open a prompt then fails here
   * instead of hanging until the suite times out.
   */
  stdin?: 'ignore' | 'inherit'
  /** Set false when a test asserts on exact stream bytes. */
  trim?: boolean
}

/** Run the compiled binary and collect both streams and the exit code. */
export async function spawnCli(args: readonly string[], opts: SpawnCliOptions = {}): Promise<CliResult> {
  const proc = Bun.spawn([CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: opts.stdin ?? 'ignore',
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  if (opts.trim === false) return { stdout, stderr, exitCode }
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
