/**
 * The environment variables `isInteractive` treats as evidence of CI.
 *
 * Declared above the block that documents `withTTY`, because it was sitting
 * between that block and the function it describes.
 */
const CI_VARS = ['CI', 'CONTINUOUS_INTEGRATION'] as const

/**
 * Force the process to look fully interactive (or fully non-interactive)
 * for the duration of a block, then restore every property it touched.
 *
 * Why this exists: production code branches on whether a real human is
 * attached — the adapter picker, the login prompt, the publish build
 * offer, the collision workspace. A test that inherits the runner's own
 * terminal state is not testing a branch, it is testing where `bun test`
 * happened to be launched from.
 *
 * Why it sets four things rather than `stdout.isTTY` alone: that is the
 * complete input to `isInteractive` in `util/interactive.ts`. An earlier
 * version of this helper set only stdout, which meant a test could assert
 * "the interactive path runs" while the real interactive path — the one
 * that calls `stdin.setRawMode` — would have thrown for a user with a
 * piped stdin. The helper now expresses the same four facts the
 * production check reads, so the two cannot drift apart.
 *
 * Everything is restored in `finally`, including deleting env vars that
 * were absent to begin with, so a thrown assertion cannot leak state into
 * the next test.
 */
export async function withTTY<T>(value: boolean, fn: () => Promise<T> | T): Promise<T> {
  const originalStdin = process.stdin.isTTY
  const originalStdout = process.stdout.isTTY
  const originalSetRawMode = process.stdin.setRawMode
  const hadSetRawMode = 'setRawMode' in process.stdin
  const originalCi = CI_VARS.map((name) => [name, process.env[name]] as const)

  setTTY(process.stdin, value)
  setTTY(process.stdout, value)

  if (value) {
    // A TTY stdin always has `setRawMode`. Supplying a no-op keeps Ink's
    // raw-mode path from throwing on the runner's real (piped) stdin.
    if (typeof process.stdin.setRawMode !== 'function') {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: () => process.stdin,
        configurable: true,
        writable: true,
      })
    }
    // CI is non-interactive by definition, so an interactive test must
    // not silently become a non-interactive one on a build machine.
    for (const name of CI_VARS) delete process.env[name]
  }

  try {
    return await fn()
  } finally {
    setTTY(process.stdin, originalStdin)
    setTTY(process.stdout, originalStdout)
    if (hadSetRawMode) {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: originalSetRawMode,
        configurable: true,
        writable: true,
      })
    } else {
      Reflect.deleteProperty(process.stdin, 'setRawMode')
    }
    for (const [name, original] of originalCi) {
      if (original === undefined) delete process.env[name]
      else process.env[name] = original
    }
  }
}

function setTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean | undefined): void {
  Object.defineProperty(stream, 'isTTY', { value, configurable: true, writable: true })
}
