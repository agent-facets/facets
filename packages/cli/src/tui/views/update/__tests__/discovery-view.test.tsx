import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { captureStdout } from '../../../../__tests__/helpers/capture-std.ts'
import { visibleTerminalText } from '../../../../__tests__/helpers/terminal-output.ts'
import { withTTY } from '../../../../__tests__/helpers/with-tty.ts'
import { withUpdateDiscovery } from '../../../../commands/update/run-discovery.ts'
import { UpdateDiscoveryView } from '../discovery-view.tsx'

describe('UpdateDiscoveryView', () => {
  test('says what it is waiting on', () => {
    const app = render(createElement(UpdateDiscoveryView))
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('Checking the registry for facet updates')
    app.unmount()
  })

  // No "3 of 12" and no percentage: discovery resolves its lookups in
  // concurrent groups and reports nothing until the whole set settles,
  // so any count rendered here would be invented rather than measured.
  test('claims no measurable progress', () => {
    const app = render(createElement(UpdateDiscoveryView))
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).not.toMatch(/\d+%/)
    expect(frame).not.toMatch(/\d+\s*(of|\/)\s*\d+/)
    app.unmount()
  })
})

describe('withUpdateDiscovery', () => {
  test('returns the work result untouched', async () => {
    const result = await withUpdateDiscovery(async () => ({ ok: true, value: 42 }), { enabled: false })
    expect(result).toEqual({ ok: true, value: 42 })
  })

  test('a non-terminal run writes nothing', async () => {
    const written: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: unknown) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    try {
      await withUpdateDiscovery(async () => 'done', { enabled: false })
    } finally {
      process.stdout.write = original
    }
    expect(written).toEqual([])
  })

  test('a rejected promise still propagates', async () => {
    await expect(
      withUpdateDiscovery(
        async () => {
          throw new Error('registry exploded')
        },
        { enabled: false },
      ),
    ).rejects.toThrow('registry exploded')
  })

  // The indicator is a wrapper, not a gate: a structured failure is an
  // ordinary return value and must reach the caller unchanged so the
  // command can translate it into its own three-line stderr block.
  test('a structured failure passes through as a value', async () => {
    const failure = { ok: false as const, failure: { reason: 'manifest-read' as const, error: 'boom' } }
    expect(await withUpdateDiscovery(async () => failure, { enabled: false })).toBe(failure)
  })
})

/**
 * The branch that actually mounts Ink.
 *
 * Every test above short-circuits before `render` is called, which left
 * the real path — a live mount, a teardown in `finally`, and the global
 * state Ink patches on the way in — completely unexercised.
 */
describe('withUpdateDiscovery — with the indicator on screen', () => {
  test('says what it is waiting on while discovery is pending', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const { stdout, result } = await withTTY(true, () =>
      captureStdout(async () => {
        const pending = withUpdateDiscovery(async () => {
          await gate
          return 'plan'
        })
        // Long enough for the comet to paint at least one frame.
        await new Promise((resolve) => setTimeout(resolve, 80))
        release()
        return pending
      }),
    )

    expect(result).toBe('plan')
    expect(stdout).toContain('Checking the registry for facet updates')
  })

  test('leaves no patched console or stray listener behind', async () => {
    const consoleLog = console.log
    const sigints = process.listenerCount('SIGINT')

    await withTTY(true, () => captureStdout(() => withUpdateDiscovery(async () => 'plan')))

    // Ink patches `console` and subscribes to exit on mount. A teardown
    // that skipped either would leave the rest of the command writing
    // through a renderer that is no longer running.
    expect(console.log).toBe(consoleLog)
    expect(process.listenerCount('SIGINT')).toBe(sigints)
  })

  test('a rejected discovery still tears the indicator down', async () => {
    const consoleLog = console.log

    await withTTY(true, () =>
      captureStdout(async () => {
        await expect(
          withUpdateDiscovery(async () => {
            throw new Error('registry exploded')
          }),
        ).rejects.toThrow('registry exploded')
      }),
    )

    expect(console.log).toBe(consoleLog)
  })

  // The default is the shared live-output rule, not a bare `isTTY` check.
  // A CI runner that allocates a pseudo-terminal passes `isTTY` while Ink
  // decides the mount is non-interactive, and its unmount then flushes a
  // comet frame into stdout ahead of the plan a caller was parsing.
  test('a CI runner with a pseudo-terminal gets no frames', async () => {
    const { stdout, result } = await withTTY(true, () => {
      process.env.CI = '1'
      return captureStdout(() => withUpdateDiscovery(async () => 'plan'))
    })

    expect(result).toBe('plan')
    expect(stdout).toBe('')
  })

  test('a non-terminal stdout gets no frames', async () => {
    const { stdout } = await withTTY(false, () => captureStdout(() => withUpdateDiscovery(async () => 'plan')))
    expect(stdout).toBe('')
  })
})
