/**
 * Test helper that forces `process.stdout.isTTY` to a specific value
 * for the duration of a block, then restores it.
 *
 * Why this exists: production code in the CLI (e.g. the adapter picker
 * gate, the "no adapters installed" hint copy) branches on
 * `process.stdout.isTTY`. Tests that exercise either branch must NOT
 * inherit the runner's TTY-ness — otherwise a test labelled
 * "non-TTY" will spuriously hang or pass depending on whether
 * `bun test` was launched from a real terminal vs a CI subprocess.
 *
 * Tests should always wrap TTY-sensitive assertions in `withTTY(true,
 * ...)` or `withTTY(false, ...)` to make the intent and the
 * environment explicit.
 *
 * The property is restored in a `finally` block so a thrown assertion
 * doesn't leak the override into the next test.
 */
export async function withTTY<T>(value: boolean, fn: () => Promise<T> | T): Promise<T> {
  const original = process.stdout.isTTY
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true, writable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true, writable: true })
  }
}
