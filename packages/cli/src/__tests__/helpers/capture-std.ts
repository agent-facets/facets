/**
 * Test helpers for capturing or silencing writes to process.stderr and
 * process.stdout during a block of code.
 *
 * These exist because CLI command handlers like `addCommand.run(...)` and
 * `installCommand.run(...)` write user-facing errors directly to stderr
 * (via writeCliError). When failure-path tests call those handlers
 * in-process, the error blocks leak into the test runner output, making
 * it hard to spot genuine test failures.
 *
 * Use `captureStderr` / `captureStdout` when you want to assert on the
 * output. Use `withSilencedStderr` / `withSilencedStdout` when you only
 * care about the return value and want the stream muted.
 *
 * Captured output has its terminal control sequences removed, because the
 * handlers colour their output whenever the real stream is a TTY: the same
 * assertion would then hold when the suite is piped and fail when a
 * developer runs it in a terminal. Whitespace is left exactly as written —
 * these streams carry the CLI's own formatting (the two-space `fix:` indent,
 * one record per line), and an assertion about that layout is legitimate.
 * Pass `{ raw: true }` when the escape sequences are the subject.
 *
 * All four helpers restore the original stream in a `finally` block,
 * even if `fn` throws.
 */

import { stripTerminalControls } from './terminal-output.ts'

type StreamName = 'stdout' | 'stderr'

export interface CaptureOptions {
  /** Keep terminal control sequences instead of removing them. */
  raw?: boolean
}

async function captureStream<T>(
  stream: StreamName,
  fn: () => T | Promise<T>,
  opts: CaptureOptions = {},
): Promise<{ result: T; output: string }> {
  const target = process[stream]
  const original = target.write.bind(target)
  const chunks: string[] = []
  target.write = ((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  }) as typeof target.write
  try {
    const result = await fn()
    const output = chunks.join('')
    return { result, output: opts.raw === true ? output : stripTerminalControls(output) }
  } finally {
    target.write = original
  }
}

/** Run `fn` with process.stderr.write captured. Returns the captured string and fn's result. */
export async function captureStderr<T>(
  fn: () => T | Promise<T>,
  opts: CaptureOptions = {},
): Promise<{ result: T; stderr: string }> {
  const { result, output } = await captureStream('stderr', fn, opts)
  return { result, stderr: output }
}

/** Run `fn` with process.stdout.write captured. Returns the captured string and fn's result. */
export async function captureStdout<T>(
  fn: () => T | Promise<T>,
  opts: CaptureOptions = {},
): Promise<{ result: T; stdout: string }> {
  const { result, output } = await captureStream('stdout', fn, opts)
  return { result, stdout: output }
}

/** Run `fn` with process.stderr.write silenced. Returns fn's result. */
export async function withSilencedStderr<T>(fn: () => T | Promise<T>): Promise<T> {
  const { result } = await captureStream('stderr', fn)
  return result
}

/** Run `fn` with process.stdout.write silenced. Returns fn's result. */
export async function withSilencedStdout<T>(fn: () => T | Promise<T>): Promise<T> {
  const { result } = await captureStream('stdout', fn)
  return result
}
