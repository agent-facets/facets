import { afterAll, afterEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as engine from '@agent-facets/engine'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { commands, resolveCommand } from '../../../commands.ts'
import { candidate } from '../../update/__tests__/fixtures.ts'
import { outdatedCommand } from '../index.ts'

type Prepare = typeof engine.prepareFacetUpdate
const prepareSpy = spyOn(engine, 'prepareFacetUpdate') as unknown as Mock<Prepare>

// Cleared, not restored, between tests — `mockRestore` retires the spy for
// good, and every test after the first would then run against the real
// engine (a real registry call this suite must never make).
afterEach(() => {
  prepareSpy.mockClear()
})

afterAll(() => {
  prepareSpy.mockRestore()
})

// A facet whose declared range already reaches a newer release than the
// one installed — a genuine candidate `update` would apply by default,
// not a no-op. That matters for the guarantee test below: a fixture
// update classifies as a no-op (target === current) never reaches the
// code path `dry-run` gates, so it would pass even if `outdated` forgot
// to force `dry-run` at all. This one only stays unwritten because the
// flag really is forced.
const STALE = candidate({
  name: 'alpha',
  source: '1.*',
  current: '1.2.0',
  target: '1.8.0',
  latest: '2.0.0',
})

function preparing(projectRoot: string): void {
  prepareSpy.mockResolvedValue({
    ok: true,
    prepared: {
      projectRoot,
      plan: [STALE],
      manifestState: { kind: 'absent' },
      lockfileState: { kind: 'absent' },
    },
  })
}

describe('facet outdated — registration', () => {
  test('is registered under its own name and resolvable through the registry', () => {
    expect(commands.outdated).toBe(outdatedCommand)
    expect(resolveCommand(commands, 'outdated')).toBe(outdatedCommand)
  })
})

describe('facet outdated — refusing the invocation', () => {
  test('a positional argument exits 1 with the exact message, and nothing is prepared', async () => {
    const { stderr, result } = await captureStderr(() => outdatedCommand.run(['alpha'], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('facet outdated does not accept positional arguments')
    expect(prepareSpy).not.toHaveBeenCalled()
  })
})

describe('facet outdated — reporting', () => {
  test('--json produces one parseable document', async () => {
    preparing(mkdtempSync(join(tmpdir(), 'facet-outdated-report-')))
    const { stdout, result } = await captureStdout(() => outdatedCommand.run([], { json: true }), { raw: true })
    expect(result).toBe(0)
    const document = JSON.parse(stdout)
    expect(document.ok).toBe(true)
    // Delegated with dry-run forced true: reporting can never claim to
    // have applied anything.
    expect(document.applied).toBe(false)
    expect(document.facets.map((facet: { name: string }) => facet.name)).toEqual(['alpha'])
  })
})

describe('facet outdated — the guarantee: it can never write', () => {
  // The promise this command makes is that it delegates to `update` with
  // `--dry-run` forced, so it cannot disagree with `update` and cannot
  // write. A comment asserting that is not proof; running it against a
  // real fixture and hashing the files before and after is.
  test('facets.json and facets.lock are byte-identical before and after a run against a stale fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'facet-outdated-guarantee-'))
    // The mock is bound to the same directory being hashed below — the
    // whole point is that there is only one root in play, so a write
    // landing anywhere the mock claims is prepared is a write the
    // assertions below would actually catch.
    preparing(dir)
    const facetsJsonPath = join(dir, 'facets.json')
    const facetsLockPath = join(dir, 'facets.lock')
    writeFileSync(facetsJsonPath, JSON.stringify({ facets: { alpha: { source: '1.*' } } }, null, 2))
    writeFileSync(
      facetsLockPath,
      JSON.stringify({ lockfileVersion: 1, facets: { alpha: { version: '1.2.0' } } }, null, 2),
    )

    const hashOf = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
    const beforeJson = hashOf(facetsJsonPath)
    const beforeLock = hashOf(facetsLockPath)
    const beforeListing = readdirSync(dir).sort()

    const previousCwd = process.cwd()
    let afterJson: string
    let afterLock: string
    let afterListing: string[]
    process.chdir(dir)
    try {
      const { result } = await captureStdout(() => outdatedCommand.run([], { json: true }), { raw: true })
      expect(result).toBe(0)
      // Hashed while still inside the fixture directory and before
      // cleanup removes it.
      afterJson = hashOf(facetsJsonPath)
      afterLock = hashOf(facetsLockPath)
      // A third file dropped beside the two we hash would pass a
      // two-file checksum comparison; the listing catches it.
      afterListing = readdirSync(dir).sort()
    } finally {
      process.chdir(previousCwd)
      rmSync(dir, { recursive: true, force: true })
    }

    expect(afterJson).toBe(beforeJson)
    expect(afterLock).toBe(beforeLock)
    expect(afterListing).toEqual(beforeListing)
  })
})
