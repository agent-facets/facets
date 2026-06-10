import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { listCommand } from '../index.ts'

let projectRoot: string
let originalCwd: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-list-test-'))
  originalCwd = process.cwd()
  process.chdir(projectRoot)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('listCommand', () => {
  test('not-a-project: prints helpful hint when facets.json is absent', async () => {
    const { result, stdout } = await captureStdout(() => listCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('No facets.json in this directory')
    expect(stdout).toContain("'facet add <name>'")
  })

  test('empty: prints "no facets installed" when facets.json has no entries', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: {} }))
    const { result, stdout } = await captureStdout(() => listCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('No facets installed in this project')
  })

  test('single entry without lockfile: shows source specifier', async () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': 'github:agent-facets/viper-plans' } }),
    )
    const { result, stdout } = await captureStdout(() => listCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('viper-plans')
    expect(stdout).toContain('github:agent-facets/viper-plans')
  })

  test('multiple entries: renders every name and value', async () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        facets: {
          a: 'val-a',
          'much-longer-name': 'val-b',
        },
      }),
    )
    const { result, stdout } = await captureStdout(() => listCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('a')
    expect(stdout).toContain('much-longer-name')
    expect(stdout).toContain('val-a')
    expect(stdout).toContain('val-b')
  })

  test('with lockfile: prefers resolved version over source specifier', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { cowsay: 'cowsay@latest' } }))
    writeFileSync(
      join(projectRoot, 'facets.lock'),
      JSON.stringify({
        lockfileVersion: 1,
        facets: {
          cowsay: {
            source: { kind: 'registry', registry: 'https://api.facet.cafe' },
            version: '0.1.0',
            integrity: 'sha256-deadbeef',
            assets: [],
          },
        },
      }),
    )
    const { result, stdout } = await captureStdout(() => listCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('cowsay')
    expect(stdout).toContain('0.1.0')
    // Source specifier should NOT appear — version takes precedence.
    expect(stdout).not.toContain('cowsay@latest')
  })

  test('lockfile missing for one entry: falls back to source for that entry only', async () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        facets: {
          installed: 'installed@1.0.0',
          'not-installed': 'github:org/not-installed',
        },
      }),
    )
    writeFileSync(
      join(projectRoot, 'facets.lock'),
      JSON.stringify({
        lockfileVersion: 1,
        facets: {
          installed: {
            source: { kind: 'registry', registry: 'https://api.facet.cafe' },
            version: '1.0.0',
            integrity: 'sha256-x',
            assets: [],
          },
        },
      }),
    )
    const { result, stdout } = await captureStdout(() => listCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('1.0.0')
    expect(stdout).toContain('github:org/not-installed')
  })

  test('malformed facets.json: writes a CliError and exits non-zero', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{not valid json')
    const { result, stderr } = await captureStderr(() => listCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('facets.json is malformed')
  })

  test('positional args are rejected', async () => {
    const { result, stderr } = await captureStderr(() => listCommand.run(['extra'], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('does not accept positional arguments')
  })
})
