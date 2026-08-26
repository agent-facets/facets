import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { visibleTerminalText } from '../../../../__tests__/helpers/terminal-output.ts'
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
