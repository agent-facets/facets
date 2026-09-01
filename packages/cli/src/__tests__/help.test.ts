import { describe, expect, test } from 'bun:test'
import type { Command } from '../commands.ts'
import { printCommandHelp } from '../help.ts'
import { captureLog } from './helpers/capture-log.ts'

function helpFor(flags: Command['flags']): string {
  return captureLog(() => {
    printCommandHelp({
      name: 'demo',
      description: 'test command',
      implemented: true,
      ...(flags ? { flags } : {}),
      run: async () => 0,
    })
  })
}

/**
 * The Options block, as `[label, description]` pairs plus the column the
 * description starts at. Alignment is asserted by comparing those columns
 * to each other rather than by hardcoding a width, so the test says
 * "these line up" instead of restating the padding arithmetic.
 */
function optionRows(help: string): { label: string; descriptionColumn: number }[] {
  const lines = help.split('\n')
  const start = lines.indexOf('Options:')
  expect(start).toBeGreaterThanOrEqual(0)
  return lines
    .slice(start + 1)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const match = /^ {2}(\S.*?) {2,}(\S.*)$/.exec(line)
      if (match === null) expect.unreachable()
      const [, label, description] = match
      if (label === undefined || description === undefined) expect.unreachable()
      return { label, descriptionColumn: line.indexOf(description) }
    })
}

describe('per-command help — short aliases', () => {
  test('a short alias renders with its long form from one declaration', () => {
    const out = helpFor({
      latest: { type: 'boolean', short: 'L', description: 'Update to the latest version' },
    })
    expect(out).toMatch(/^ +-L, --latest\s+Update to the latest version$/m)
  })

  test('descriptions stay aligned when a short-aliased label is the longest', () => {
    const out = helpFor({
      latest: { type: 'boolean', short: 'L', description: 'Update to the latest version' },
      interactive: { type: 'boolean', short: 'i', description: 'Choose facets to update' },
      'dry-run': { type: 'boolean', description: 'Preview without applying' },
    })
    const rows = optionRows(out)
    // Four declared/implicit rows: three flags plus --help.
    expect(rows.map((r) => r.label)).toEqual(['-L, --latest', '-i, --interactive', '--dry-run', '--help'])
    const columns = new Set(rows.map((r) => r.descriptionColumn))
    expect(columns.size).toBe(1)
  })

  test('a command with no short aliases renders exactly as before', () => {
    const out = helpFor({
      force: { type: 'boolean', description: 'Overwrite existing files' },
      name: { type: 'string', description: 'Facet name' },
    })
    const rows = optionRows(out)
    expect(rows.map((r) => r.label)).toEqual(['--force', '--name', '--help'])
    expect(new Set(rows.map((r) => r.descriptionColumn)).size).toBe(1)
    expect(out).not.toContain('-f,')
  })

  test('a command with no flags still documents --help', () => {
    const out = helpFor(undefined)
    expect(out).toMatch(/--help\s+Show help/)
  })
})
