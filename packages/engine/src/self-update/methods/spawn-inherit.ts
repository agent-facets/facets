import type { SelfUpdateErrorHandler } from './types.ts'

/**
 * Spawn a command with stdio inherited from the parent so progress
 * (download bars, npm install logs, etc.) reaches the user in real time.
 *
 * Returns the child's exit code so callers can pass it through to the user.
 * If `Bun.spawn` itself throws (e.g., the binary is not on `$PATH`), the
 * error is emitted via the structured `onError` channel as a
 * `{ kind: 'message' }` event (the CLI wires this to stderr) and we
 * return 1 — surfaces the failure without translating it into something
 * less helpful.
 */
export async function spawnInherit(cmd: string[], opts: { onError?: SelfUpdateErrorHandler } = {}): Promise<number> {
  const [first, ...rest] = cmd
  if (first === undefined) return 1
  try {
    const proc = Bun.spawn([first, ...rest], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    return await proc.exited
  } catch (e) {
    opts.onError?.({
      kind: 'message',
      line: `${first}: ${e instanceof Error ? e.message : String(e)}\n`,
    })
    return 1
  }
}
