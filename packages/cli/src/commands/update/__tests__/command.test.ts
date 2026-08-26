import { afterAll, afterEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import * as engine from '@agent-facets/engine'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import * as adapterModule from '../../shared/ensure-adapters.ts'
import { updateCommand } from '../index.ts'
import * as pickerModule from '../run-picker.ts'
import { candidate, current, unsupported } from './fixtures.ts'

type Prepare = typeof engine.prepareFacetUpdate
const prepareSpy = spyOn(engine, 'prepareFacetUpdate') as unknown as Mock<Prepare>
const adaptersSpy = spyOn(adapterModule, 'ensureAdapters')
// Stubbed rather than mounted: the real picker waits on keystrokes, so a
// test that let it open would hang until the suite timed out.
const pickerSpy = spyOn(pickerModule, 'runUpdatePicker')

// Cleared, not restored: `mockRestore` retires the spy for good, and
// every test after the first would then run against the real engine.
afterEach(() => {
  prepareSpy.mockClear()
  adaptersSpy.mockClear()
  pickerSpy.mockClear()
})

afterAll(() => {
  prepareSpy.mockRestore()
  adaptersSpy.mockRestore()
  pickerSpy.mockRestore()
})

function preparing(plan: engine.UpdatePlanRow[]): void {
  prepareSpy.mockResolvedValue({
    ok: true,
    prepared: {
      projectRoot: '/tmp/project',
      plan,
      manifestState: { kind: 'absent' },
      lockfileState: { kind: 'absent' },
    },
  })
}

const BOUNDED = candidate({
  name: 'alpha',
  source: '1.*',
  current: '1.2.0',
  target: '1.8.0',
  latest: '2.0.0',
  advancing: 'range-and-latest',
})

const PINNED = candidate({
  name: 'beta',
  source: '1.2.0',
  current: '1.2.0',
  target: '1.2.0',
  latest: '3.4.1',
  advancing: 'latest-only',
})

describe('facet update — refusing the invocation', () => {
  test('a positional argument is refused, pointing at the flag that replaces it', async () => {
    const { stderr, result } = await captureStderr(() => updateCommand.run(['alpha'], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('does not accept positional arguments')
    expect(stderr).toContain('--interactive')
    // Refused before anything looked at the project.
    expect(prepareSpy).not.toHaveBeenCalled()
  })

  // The gate is before discovery on purpose: waiting through every
  // registry lookup to be told the screen cannot open is the one
  // ordering that wastes the user's time and the registry's.
  test('--interactive without a terminal fails before any registry lookup', async () => {
    const { stderr, result } = await withTTY(false, () =>
      captureStderr(() => updateCommand.run([], { interactive: true })),
    )
    expect(result).toBe(1)
    expect(stderr).toContain('interactive terminal')
    expect(prepareSpy).not.toHaveBeenCalled()
    expect(adaptersSpy).not.toHaveBeenCalled()
  })
})

describe('facet update — preparation failures', () => {
  test('an unusable project names every affected facet and sends the user to install', async () => {
    prepareSpy.mockResolvedValue({
      ok: false,
      failure: {
        reason: 'unusable-facet-state',
        facets: [
          { name: 'alpha', reason: { code: 'missing-lock-entry' } },
          { name: 'beta', reason: { code: 'invalid-locked-version', version: 'not-a-version' } },
        ],
      },
    })
    const { stderr, result } = await captureStderr(() => updateCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('alpha')
    expect(stderr).toContain('beta')
    expect(stderr).toContain('facet install')
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  test('a registry failure is reported in the registry’s own words', async () => {
    prepareSpy.mockResolvedValue({
      ok: false,
      failure: { reason: 'discovery-failed', error: { code: 'NETWORK_ERROR', cause: 'ECONNREFUSED', attempts: 3 } },
    })
    const { stderr, result } = await captureStderr(() => updateCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('could not reach the registry')
    expect(stderr).toContain('ECONNREFUSED')
  })

  test('a project that moved during discovery says so, and says to re-run', async () => {
    prepareSpy.mockResolvedValue({
      ok: false,
      failure: { reason: 'project-changed-during-discovery', file: 'lockfile' },
    })
    const { stderr, result } = await captureStderr(() => updateCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('facets.lock changed')
    expect(stderr).toContain("re-run 'facet update'")
  })
})

describe('facet update — successful runs that apply nothing', () => {
  test('a project with no registry facets says so and succeeds', async () => {
    preparing([unsupported('delta', 'github:a/b', 'git')])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('No registry facets to update')
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  test('everything current says so and succeeds', async () => {
    preparing([current({ name: 'gamma', source: '*', version: '4.0.0' })])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('All registry facets are current')
  })

  test('a blocked range names --latest, and does not pretend to be current', async () => {
    preparing([PINNED])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('facet update --latest')
    expect(stdout).not.toContain('are current')
    expect(adaptersSpy).not.toHaveBeenCalled()
  })
})

describe('facet update — opening the interactive picker', () => {
  // The bug this guards: gating the picker on the mode's DEFAULT
  // selection instead of on the candidate rows. An exact pin has a
  // stationary target and an advancing latest, so plain `--interactive`
  // produced an empty default selection, tripped the range no-op, and
  // told the user to re-run with `--latest` -- the exact job the screen
  // they asked for was there to do.
  test('a latest-only candidate opens the picker instead of the range no-op', async () => {
    preparing([PINNED])
    pickerSpy.mockResolvedValue({ kind: 'cancelled' })
    const { stdout, result } = await withTTY(true, () =>
      captureStdout(() => updateCommand.run([], { interactive: true })),
    )
    expect(pickerSpy).toHaveBeenCalled()
    expect(stdout).not.toContain('facet update --latest')
    expect(result).toBe(1)
  })

  test('the picker starts on the mode the flags asked for', async () => {
    preparing([BOUNDED])
    pickerSpy.mockResolvedValue({ kind: 'cancelled' })
    await withTTY(true, () => captureStdout(() => updateCommand.run([], { interactive: true })))
    expect(pickerSpy.mock.calls[0]?.[1]).toBe('range')

    pickerSpy.mockClear()
    await withTTY(true, () => captureStdout(() => updateCommand.run([], { interactive: true, latest: true })))
    expect(pickerSpy.mock.calls[0]?.[1]).toBe('latest')
  })

  // Interactive has a dead end, it is just a different one: a plan with
  // no candidate row at all has nothing to put on screen.
  test('a plan with no candidate at all still reports the specific no-op', async () => {
    preparing([current({ name: 'gamma', source: '*', version: '4.0.0' })])
    const { stdout, result } = await withTTY(true, () =>
      captureStdout(() => updateCommand.run([], { interactive: true })),
    )
    expect(pickerSpy).not.toHaveBeenCalled()
    expect(stdout).toContain('All registry facets are current')
    expect(result).toBe(0)
  })

  test('a project with no registry facets never opens the picker', async () => {
    preparing([unsupported('delta', 'github:a/b', 'git')])
    const { stdout, result } = await withTTY(true, () =>
      captureStdout(() => updateCommand.run([], { interactive: true })),
    )
    expect(pickerSpy).not.toHaveBeenCalled()
    expect(stdout).toContain('No registry facets to update')
    expect(result).toBe(0)
  })

  test('cancelling applies nothing, says so, and exits non-zero', async () => {
    preparing([BOUNDED])
    pickerSpy.mockResolvedValue({ kind: 'cancelled' })
    const { stdout, result } = await withTTY(true, () =>
      captureStdout(() => updateCommand.run([], { interactive: true })),
    )
    expect(result).toBe(1)
    expect(stdout).toContain('Nothing was applied')
    // Cancelling must not have cost an adapter install.
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  test('a confirmed selection under --dry-run previews and stops', async () => {
    preparing([PINNED])
    pickerSpy.mockResolvedValue({ kind: 'confirmed', selections: [{ facetName: 'beta', choice: 'latest' }] })
    const { stdout, result } = await withTTY(true, () =>
      captureStdout(() => updateCommand.run([], { interactive: true, 'dry-run': true })),
    )
    expect(result).toBe(0)
    expect(stdout).toContain('3.4.1')
    expect(adaptersSpy).not.toHaveBeenCalled()
  })
})

describe('facet update — dry run', () => {
  test('prints the plan, installs no adapter, and succeeds', async () => {
    preparing([BOUNDED, PINNED])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], { 'dry-run': true }))
    expect(result).toBe(0)
    expect(stdout).toContain('alpha')
    expect(stdout).toContain('1.8.0')
    // The whole point of a preview: nothing that could install anything
    // has been reached.
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  test('latest mode previews the manifest edits it would commit', async () => {
    preparing([BOUNDED, PINNED])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], { 'dry-run': true, latest: true }))
    expect(result).toBe(0)
    expect(stdout).toContain('facets.json')
    expect(stdout).toContain('2.*')
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  test('a dry run with nothing to do still succeeds', async () => {
    preparing([current({ name: 'gamma', source: '*', version: '4.0.0' })])
    const { result } = await captureStdout(() => updateCommand.run([], { 'dry-run': true }))
    expect(result).toBe(0)
    expect(adaptersSpy).not.toHaveBeenCalled()
  })
})
