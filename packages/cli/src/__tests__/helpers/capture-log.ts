/**
 * Capture `console.log` output during a synchronous body.
 *
 * `help.ts` writes through `console.log` rather than `process.stdout.write`,
 * so the `capture-std` helpers cannot see it. Anything asserting on rendered
 * help needs this one instead.
 */
export function captureLog(fn: () => void): string {
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
