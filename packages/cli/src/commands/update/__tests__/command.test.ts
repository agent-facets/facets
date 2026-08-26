import { afterAll, afterEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import * as engine from '@agent-facets/engine'
import { CURRENT_LOCKFILE_VERSION } from '@agent-facets/protocol'
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
})

const PINNED = candidate({
  name: 'beta',
  source: '1.2.0',
  current: '1.2.0',
  target: '1.2.0',
  latest: '3.4.1',
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

  // `--latest` is a non-interactive mode's way of saying what the picker
  // already offers on every row, so it cannot change what opens. If it
  // ever grows a second starting state again, this is what catches it.
  test('--latest opens the same picker as plain interactive mode', async () => {
    preparing([BOUNDED, PINNED])
    pickerSpy.mockResolvedValue({ kind: 'cancelled' })
    await withTTY(true, () => captureStdout(() => updateCommand.run([], { interactive: true })))
    const plain = pickerSpy.mock.calls[0]

    pickerSpy.mockClear()
    await withTTY(true, () => captureStdout(() => updateCommand.run([], { interactive: true, latest: true })))
    const withLatest = pickerSpy.mock.calls[0]

    expect(withLatest).toEqual(plain)
    // The candidates, and nothing else: no mode reaches this screen.
    expect(plain).toHaveLength(1)
    expect(plain?.[0]).toEqual([BOUNDED, PINNED])
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
    const applySpy = spyOn(engine, 'runPreparedFacetUpdate')

    const { stdout, result } = await withTTY(true, () =>
      captureStdout(() => updateCommand.run([], { interactive: true })),
    )

    expect(result).toBe(1)
    expect(stdout).toContain('Nothing was applied')
    // Nothing downstream of the decision ran: no adapter was selected or
    // installed, and the transaction that writes the manifest, lockfile,
    // receipt, assets, and native configuration was never entered.
    expect(adaptersSpy).not.toHaveBeenCalled()
    expect(applySpy).not.toHaveBeenCalled()
    applySpy.mockRestore()
  })

  // A screen that could not be shown is not a decision. Reporting it as a
  // cancellation would put a defect behind a message saying all is well.
  test('a picker that cannot be shown is an error, not a silent cancellation', async () => {
    preparing([BOUNDED])
    pickerSpy.mockResolvedValue({ kind: 'unavailable', cause: 'Raw mode is not supported' })
    const { stderr, result } = await withTTY(true, () =>
      captureStderr(() => captureStdout(() => updateCommand.run([], { interactive: true }))),
    )
    expect(result.result).toBe(1)
    expect(stderr).toContain('could not be shown')
    expect(result.stdout).not.toContain('Nothing was applied')
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

  // A preview that found nothing still has to say WHICH nothing, or it
  // reads as "the check did not run".
  test('a dry run with nothing to do says which kind of nothing', async () => {
    preparing([current({ name: 'gamma', source: '*', version: '4.0.0' })])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], { 'dry-run': true }))
    expect(result).toBe(0)
    expect(stdout).toContain('All registry facets are current')
    expect(adaptersSpy).not.toHaveBeenCalled()
  })
})

/**
 * The applying path, driven through the real Ink view.
 *
 * Only the engine call is stubbed. Everything between the command and it —
 * adapter selection, the mount, the consent policy, the exit code — is the
 * code that actually ships.
 */
describe('facet update — applying', () => {
  const applied: engine.RunPreparedFacetUpdateResult = {
    ok: true,
    install: {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 0, updated: 1, repaired: 0, unchanged: 0, removed: 0 },
        textAssets: { written: 1, removed: 0 },
        mcp: {
          configurations: { added: 0, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
          declarations: { aliased: 0, omitted: 0 },
          takeovers: { accepted: 0 },
        },
      },
      perFacet: [{ kind: 'updated', name: 'alpha', oldVersion: '1.2.0', newVersion: '1.8.0' }],
      mcp: { consent: { kind: 'not-required' }, dispositions: [], configurations: [], prunedIntent: [] },
    },
  }

  function applying(result: engine.RunPreparedFacetUpdateResult = applied) {
    adaptersSpy.mockResolvedValue([])
    return spyOn(engine, 'runPreparedFacetUpdate').mockResolvedValue(result)
  }

  test('a failed application is reported on stderr and exits one', async () => {
    preparing([BOUNDED])
    const runSpy = applying({
      ok: false,
      phase: 'install',
      install: {
        ok: false,
        failure: { code: 'UPDATE_PLAN_STALE', files: ['manifest'] },
        rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
      },
    } as engine.RunPreparedFacetUpdateResult)

    const { stderr, result } = await withTTY(false, () =>
      captureStderr(() => captureStdout(() => updateCommand.run([], {}))),
    )

    expect(result.result).toBe(1)
    expect(stderr).toContain('update failed')
    // The stale-plan remedy, not a generic "fix the underlying issue".
    expect(stderr).toContain("Re-run 'facet update'")
    runSpy.mockRestore()
  })

  test('a successful application exits zero', async () => {
    preparing([BOUNDED])
    const runSpy = applying()
    const { result } = await withTTY(false, () => captureStdout(() => updateCommand.run([], {})))
    expect(result).toBe(0)
    runSpy.mockRestore()
  })

  // The `self-` prefix is the only thing separating this command from the
  // one that replaces the binary, and they sit one keystroke apart.
  test('applying project updates never reaches the CLI-binary updater', async () => {
    preparing([BOUNDED])
    const runSpy = applying()
    const selfUpdateSpy = spyOn(engine, 'runSelfUpdate')

    const { result } = await withTTY(false, () => captureStdout(() => updateCommand.run([], {})))

    expect(result).toBe(0)
    expect(selfUpdateSpy).not.toHaveBeenCalled()
    selfUpdateSpy.mockRestore()
    runSpy.mockRestore()
  })

  // `--verbose` is the only thing that turns on engine diagnostics. Passing
  // `onLog` unconditionally would send them to stderr on every run.
  test('diagnostics are wired only when --verbose is given', async () => {
    preparing([BOUNDED])
    const runSpy = applying()

    await withTTY(false, () => captureStdout(() => updateCommand.run([], {})))
    expect(runSpy.mock.calls[0]?.[0]?.onLog).toBeUndefined()

    runSpy.mockClear()
    await withTTY(false, () => captureStdout(() => updateCommand.run([], { verbose: true })))
    expect(typeof runSpy.mock.calls[0]?.[0]?.onLog).toBe('function')
    runSpy.mockRestore()
  })

  test('non-interactive MCP work needs --accept-mcp, and it authorizes nothing else', async () => {
    preparing([BOUNDED])
    const runSpy = applying()

    await withTTY(false, () => captureStdout(() => updateCommand.run([], {})))
    // No flag, no terminal: the run must fail with the full list rather
    // than prompt or silently proceed.
    expect(runSpy.mock.calls[0]?.[0]?.mcpConsent).toEqual({ kind: 'unavailable' })
    // Taking over a file someone else wrote is a separate decision, and
    // `--accept-mcp` is not a vote on it.
    expect(runSpy.mock.calls[0]?.[0]?.resolveAssetTakeover).toBeUndefined()

    runSpy.mockClear()
    await withTTY(false, () => captureStdout(() => updateCommand.run([], { 'accept-mcp': true })))
    expect(runSpy.mock.calls[0]?.[0]?.mcpConsent).toEqual({ kind: 'preapproved' })
    expect(runSpy.mock.calls[0]?.[0]?.resolveAssetTakeover).toBeUndefined()
    runSpy.mockRestore()
  })
})
