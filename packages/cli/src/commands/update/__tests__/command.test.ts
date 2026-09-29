import { afterAll, afterEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import * as engine from '@agent-facets/engine'
import { CURRENT_LOCKFILE_VERSION } from '@agent-facets/protocol'
import { captureStderr, captureStdout, withSilencedStdout } from '../../../__tests__/helpers/capture-std.ts'
import { stripTerminalControls } from '../../../__tests__/helpers/terminal-output.ts'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import * as pickerInstallModule from '../../adapter/pick-and-install.ts'
import * as adapterModule from '../../shared/ensure-adapters.ts'
import { updateCommand } from '../index.ts'
import * as discoveryModule from '../run-discovery.ts'
import * as pickerModule from '../run-picker.ts'
import { candidate, current, unsupported } from './fixtures.ts'

type Prepare = typeof engine.prepareFacetUpdate
const prepareSpy = spyOn(engine, 'prepareFacetUpdate') as unknown as Mock<Prepare>
// `let`, because one test below has to put the REAL `ensureAdapters`
// back to exercise its headless path. Restoring a spy retires it for
// good, so that test re-installs a fresh one and rebinds this name —
// every later test still gets a stub instead of the real thing.
let adaptersSpy = spyOn(adapterModule, 'ensureAdapters')
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

/** A run that wrote: one facet moved, one asset written, no MCP work. */
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

/**
 * Stub the engine call and let the adapters through, so everything
 * between the command and the engine is the code that ships.
 *
 * At module scope because the Ink-driven path and the `--json` path are
 * two drivers for the same engine call, and a second copy of this
 * fixture is the one way their tests could end up asserting against
 * different outcomes.
 */
function applying(result: engine.RunPreparedFacetUpdateResult = applied) {
  adaptersSpy.mockResolvedValue([])
  return spyOn(engine, 'runPreparedFacetUpdate').mockResolvedValue(result)
}

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

  // ...and it has to show the rows that reason was read off. Printing
  // the sentence alone asks the user to accept a claim about their
  // project without any of the evidence for it.
  test('a dry run with everything current still shows the plan', async () => {
    preparing([current({ name: 'gamma', source: '*', version: '4.0.0' })])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], { 'dry-run': true }))
    expect(result).toBe(0)
    expect(stdout).toContain('gamma')
    expect(stdout).toContain('4.0.0')
    expect(stdout).toContain('All registry facets are current')
  })

  test('a dry run whose ranges block everything shows what is being held back', async () => {
    preparing([PINNED])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], { 'dry-run': true }))
    expect(result).toBe(0)
    // The pin, what it holds, and the release it is holding back from.
    expect(stdout).toContain('beta')
    expect(stdout).toContain('1.2.0')
    expect(stdout).toContain('3.4.1')
    expect(stdout).toContain('facet update --latest')
    // Nothing is selected, so no row is marked and no manifest edit is
    // shown — both would describe a change this run is not making.
    expect(stdout).not.toContain('▸')
    expect(stdout).not.toContain('→')
  })

  test('a dry run of a project with only unsupported sources names them', async () => {
    preparing([unsupported('delta', './local', 'local')])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], { 'dry-run': true }))
    expect(result).toBe(0)
    expect(stdout).toContain('delta')
    expect(stdout).toContain('not checked for updates')
    expect(stdout).toContain('No registry facets to update')
  })

  // The terse path: without `--dry-run` there was never a plan to
  // review, so printing one would be answering a question nobody asked.
  test('a no-op outside a dry run reports the reason alone', async () => {
    preparing([PINNED])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('facet update --latest')
    expect(stdout).not.toContain('beta')
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

  // The engine refusing a selection is a documented outcome of this
  // command, not an exception. It reaches the command as a returned
  // value through the view's result channel, is reported on stderr with
  // its own remedy, and exits 1 like every other expected failure.
  test('a refused selection is reported on stderr and exits one', async () => {
    preparing([BOUNDED])
    const runSpy = applying({
      ok: false,
      phase: 'selection',
      failure: { reason: 'unknown-facet', facet: 'ghost' },
    })

    const { stderr, result } = await withTTY(false, () =>
      captureStderr(() => captureStdout(() => updateCommand.run([], {}))),
    )

    expect(result.result).toBe(1)
    expect(stderr).toContain('ghost')
    runSpy.mockRestore()
  })

  // The other half of the same contract: with expected failures off the
  // rejection channel, a genuine crash is the only thing left on it and
  // must not be quietly reshaped into "update failed". It escapes to the
  // CLI's top level, which reports it as unexpected and exits 2.
  test('an unexpected engine crash escapes rather than becoming an update error', async () => {
    preparing([BOUNDED])
    adaptersSpy.mockResolvedValue([])
    const runSpy = spyOn(engine, 'runPreparedFacetUpdate').mockRejectedValue(new Error('engine fell over'))

    await expect(
      withTTY(false, () => captureStderr(() => captureStdout(() => updateCommand.run([], {})))),
    ).rejects.toThrow('engine fell over')

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

  test('CI stays non-interactive even when the runner allocates a pseudo-terminal', async () => {
    preparing([BOUNDED])
    const runSpy = applying()

    await withTTY(true, async () => {
      process.env.CI = '1'
      await captureStdout(() => updateCommand.run([], {}))
    })

    const options = runSpy.mock.calls[0]?.[0]
    expect(options?.mcpConsent).toEqual({ kind: 'unavailable' })
    expect(options?.resolveCollisions).toBeUndefined()
    expect(options?.resolveAssetTakeover).toBeUndefined()
    runSpy.mockRestore()
  })
})

/**
 * `--json` on every outcome this command has: a discovery failure, a
 * no-op, `--dry-run`, and a run that actually applies.
 *
 * The one assertion nearly all of these share is `JSON.parse(stdout)`
 * off the raw capture. It is doing real work — a plan table, a prose
 * no-op line, or a stray spinner frame in front of the document all
 * make it throw, which is the whole promise `--json` makes.
 *
 * The applying path is covered too, at the end: it now runs the engine
 * with no view mounted and writes a document saying it applied.
 */
describe('facet update — --json', () => {
  test('--json --dry-run writes one document and nothing else', async () => {
    preparing([BOUNDED, PINNED])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], { 'dry-run': true, json: true }), {
      raw: true,
    })

    expect(result).toBe(0)
    const document = JSON.parse(stdout)
    expect(document.ok).toBe(true)
    // A dry run wrote nothing, and the document has to say so.
    expect(document.applied).toBe(false)
    expect(document.facets.map((facet: { name: string }) => facet.name)).toEqual(['alpha', 'beta'])
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  // The document reports the run that produced it, not a fresh opinion
  // about the plan. `beta` is pinned: the same plan is `held` in range
  // mode and `updated` under `--latest`, so a document that ignored the
  // mode would give one of these two the other's answer.
  test('--latest reaches the document, so its outcomes match the run', async () => {
    preparing([PINNED])
    const range = await captureStdout(() => updateCommand.run([], { 'dry-run': true, json: true }), { raw: true })
    const latest = await captureStdout(() => updateCommand.run([], { 'dry-run': true, json: true, latest: true }), {
      raw: true,
    })

    expect(JSON.parse(range.stdout).facets[0].outcome).toBe('held')
    expect(JSON.parse(latest.stdout).facets[0].outcome).toBe('updated')
  })

  // The prose no-op line says which nothing this is in English. A parser
  // cannot read it, and it is not JSON, so emitting it alongside the
  // document would break the document.
  test('a no-op run emits a document instead of the prose line', async () => {
    preparing([current({ name: 'gamma', source: '*', version: '4.0.0' })])
    const { stdout, result } = await captureStdout(() => updateCommand.run([], { json: true }), { raw: true })

    expect(result).toBe(0)
    expect(stdout).not.toContain('All registry facets are current')
    const document = JSON.parse(stdout)
    expect(document.ok).toBe(true)
    expect(document.counts).toEqual({ updated: 0, current: 1, held: 0, unsupported: 0 })
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  // `--json` changes the format of the report, never the exit code. A
  // script that only checks `$?` has to still see this fail.
  test('a preparation failure is an ok:false document on stdout, and still exits 1', async () => {
    prepareSpy.mockResolvedValue({
      ok: false,
      failure: { reason: 'discovery-failed', error: { code: 'NETWORK_ERROR', cause: 'ECONNREFUSED', attempts: 3 } },
    })
    const { stderr, result } = await captureStderr(() =>
      captureStdout(() => updateCommand.run([], { json: true }), { raw: true }),
    )

    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    expect(document.error.what).toContain('could not reach the registry')
    expect(document.error.detail).toContain('ECONNREFUSED')
    // The report moved to stdout. Printing the human block as well would
    // report the same failure twice, in two formats.
    expect(stderr).toBe('')
  })

  // The ordering this pins down: in CI, `--json --interactive` trips the
  // terminal-capability check too, and whichever check runs first is the
  // reason the user reads. "needs an interactive terminal" is the wrong
  // one — these two flags contradict each other on any terminal. Run
  // non-TTY on purpose, because that is the environment where the wrong
  // ordering would pass on a developer's machine and fail in CI.
  test('--json --interactive is refused for the flags, not the terminal, in a non-TTY', async () => {
    const { stderr, result } = await withTTY(false, () =>
      captureStderr(() => captureStdout(() => updateCommand.run([], { json: true, interactive: true }), { raw: true })),
    )

    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    expect(document.error.what).toBe('facet update --json cannot be combined with --interactive')
    expect(document.error.what).not.toContain('needs an interactive terminal')
    // The reason is on stdout now, so stderr has to be silent: a
    // consumer that reads both would see the same refusal twice.
    expect(stderr).toBe('')
    // Refused before anything looked at the project or the registry.
    expect(prepareSpy).not.toHaveBeenCalled()
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  test('--json --interactive is refused on a real terminal too', async () => {
    const { stderr, result } = await withTTY(true, () =>
      captureStderr(() => captureStdout(() => updateCommand.run([], { json: true, interactive: true }), { raw: true })),
    )

    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    expect(document.error.what).toBe('facet update --json cannot be combined with --interactive')
    expect(document.error.detail).toBe('the picker writes to stdout, which would corrupt the JSON document')
    expect(document.error.fix).toBe("run 'facet update --json --dry-run' to see what would change without prompting")
    expect(stderr).toBe('')
    expect(prepareSpy).not.toHaveBeenCalled()
  })

  // The discovery indicator is a second Ink writer and it is ON by
  // default on a live terminal, so a `--json` run in a terminal would
  // emit frames in front of the document. No captured-output assertion
  // can catch that under a piped test runner, so the switch itself is
  // what gets asserted here.
  test('the discovery indicator is switched off in JSON mode, and left alone otherwise', async () => {
    preparing([BOUNDED])
    const discoverySpy = spyOn(discoveryModule, 'withUpdateDiscovery')
    try {
      await withTTY(true, () => captureStdout(() => updateCommand.run([], { 'dry-run': true, json: true })))
      expect(discoverySpy.mock.calls[0]?.[1]).toEqual({ enabled: false })

      // ...and a run that is not `--json` keeps the indicator it would
      // have had. Hard-wiring `!json` here would force it ON for every
      // ordinary piped run, which is the same leak in the other
      // direction.
      discoverySpy.mockClear()
      await withTTY(true, () => captureStdout(() => updateCommand.run([], { 'dry-run': true })))
      expect(discoverySpy.mock.calls[0]?.[1]).toEqual({ enabled: true })

      discoverySpy.mockClear()
      await withTTY(false, () => captureStdout(() => updateCommand.run([], { 'dry-run': true })))
      expect(discoverySpy.mock.calls[0]?.[1]).toEqual({ enabled: false })
    } finally {
      discoverySpy.mockRestore()
    }
  })

  test('a run that applies writes one document saying it applied, and exits 0', async () => {
    preparing([BOUNDED])
    const runSpy = applying()

    const { stdout, result } = await withTTY(false, () =>
      captureStdout(() => updateCommand.run([], { json: true }), { raw: true }),
    )

    expect(result).toBe(0)
    expect(runSpy).toHaveBeenCalled()
    const document = JSON.parse(stdout)
    expect(document.ok).toBe(true)
    // The difference between this and every other document the command
    // writes: something was actually written to the project.
    expect(document.applied).toBe(true)
    expect(document.facets.map((facet: { name: string }) => facet.name)).toEqual(['alpha'])
    runSpy.mockRestore()
  })

  // The guard for the whole change. On a live terminal the old code
  // mounted `InstallView` here, and Ink's very first frame — cursor
  // moves, clears, the spinner — lands on stdout in front of the
  // document. Run with a TTY on purpose, because that is the only
  // environment where a mount is visible: both the parse and the
  // control-sequence check hold trivially under a piped runner.
  test('an applying --json run mounts no Ink: stdout is one JSON value and nothing else', async () => {
    preparing([BOUNDED])
    const runSpy = applying()

    const { stdout, result } = await withTTY(true, () =>
      captureStdout(() => updateCommand.run([], { json: true }), { raw: true }),
    )

    expect(result).toBe(0)
    // Node's own idea of a control sequence, so this cannot disagree
    // with what the capture helper strips everywhere else.
    expect(stripTerminalControls(stdout)).toBe(stdout)
    // One value, not a document with frames appended: re-serializing the
    // parse has to give back the whole stream.
    const document = JSON.parse(stdout)
    expect(stdout).toBe(`${JSON.stringify(document, null, 2)}\n`)
    expect(document.applied).toBe(true)
    runSpy.mockRestore()
  })

  // `--json` on a real terminal is the case that matters: the terminal
  // can prompt, and nothing must ask it to. A resolver would open a
  // screen over the document with nobody there to answer, so the run
  // takes the same consent policy a non-interactive one does and fails
  // with the full MCP request instead.
  test('a --json run never prompts, even on a terminal that could', async () => {
    preparing([BOUNDED])
    const runSpy = applying()

    await withTTY(true, () => captureStdout(() => updateCommand.run([], { json: true, verbose: true })))

    const options = runSpy.mock.calls[0]?.[0]
    expect(options?.resolveCollisions).toBeUndefined()
    expect(options?.resolveAssetTakeover).toBeUndefined()
    expect(options?.mcpConsent).toEqual({ kind: 'unavailable' })
    // `--verbose` is prose on stderr; the document is the only thing a
    // `--json` run says, so the diagnostics stay off.
    expect(options?.onLog).toBeUndefined()
    // ...and `--accept-mcp` still reaches the engine, because that is an
    // answer given up front rather than a prompt.
    runSpy.mockClear()
    await withTTY(true, () => captureStdout(() => updateCommand.run([], { json: true, 'accept-mcp': true })))
    expect(runSpy.mock.calls[0]?.[0]?.mcpConsent).toEqual({ kind: 'preapproved' })
    runSpy.mockRestore()
  })

  test('a failed application is an ok:false document on stdout, and still exits 1', async () => {
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
      captureStderr(() => captureStdout(() => updateCommand.run([], { json: true }), { raw: true })),
    )

    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    // The same words the human path uses, from the same producers: the
    // stale-plan remedy, not a generic "fix the underlying issue".
    expect(document.error.what).toBe('update failed')
    expect(document.error.detail).toContain('UPDATE_PLAN_STALE')
    expect(document.error.fix).toContain("Re-run 'facet update'")
    // The report moved to stdout; printing the three-line block as well
    // would report one failure twice, in two formats.
    expect(stderr).not.toContain('error:')
    runSpy.mockRestore()
  })

  // The other failure phase. It never reaches an install, so it has no
  // rollback and no disk state to describe — just the refused selection.
  test('a refused selection is an ok:false document too, and exits 1', async () => {
    preparing([BOUNDED])
    const runSpy = applying({
      ok: false,
      phase: 'selection',
      failure: { reason: 'unknown-facet', facet: 'ghost' },
    })

    const { stderr, result } = await withTTY(false, () =>
      captureStderr(() => captureStdout(() => updateCommand.run([], { json: true }), { raw: true })),
    )

    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    expect(`${document.error.what} ${document.error.detail}`).toContain('ghost')
    expect(stderr).toBe('')
    runSpy.mockRestore()
  })
})

/**
 * The four ways a `--json` run can refuse before it ever reaches the
 * engine: a positional argument, the flag conflict, the terminal check
 * behind it, and adapter discovery coming up empty.
 *
 * All four used to print prose to stderr and exit 1 with an empty
 * stdout, which is exactly what a crash looks like to the unattended CI
 * that reads this command. Every test here asserts the same three
 * things: stdout parses as ONE document, that document says `ok: false`
 * in the command's existing words, and stderr stayed silent.
 */
describe('facet update — --json refuses with a document, never with prose', () => {
  test('a positional argument is one ok:false document on stdout, and exits 1', async () => {
    const { stderr, result } = await captureStderr(() =>
      captureStdout(() => updateCommand.run(['alpha'], { json: true }), { raw: true }),
    )

    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    // The same sentence the human path prints, moved rather than reworded.
    expect(document.error.what).toBe('facet update does not accept positional arguments (got "alpha")')
    expect(document.error.detail).toBe('update considers every facet declared in facets.json')
    expect(document.error.fix).toBe("run 'facet update --interactive' to choose which facets to update")
    expect(stderr).toBe('')
    // Refused before anything looked at the project.
    expect(prepareSpy).not.toHaveBeenCalled()
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  // Without `--json` the prose block is still the right answer. This is
  // the guard against "fixed" meaning "every user now reads JSON".
  test('the same refusal without --json is still prose on stderr', async () => {
    const { stderr, result } = await captureStderr(() => updateCommand.run(['alpha'], {}))

    expect(result).toBe(1)
    expect(stderr).toContain('does not accept positional arguments')
  })

  // Two refusals are true at once here. Only the first may speak: two
  // JSON values on one stream is not a document, it is a parse error.
  test('a positional argument AND --interactive still produce exactly one document', async () => {
    const { stderr, result } = await withTTY(false, () =>
      captureStderr(() =>
        captureStdout(() => updateCommand.run(['alpha'], { json: true, interactive: true }), { raw: true }),
      ),
    )

    expect(result.result).toBe(1)
    // The parse is the assertion: a second document appended to the
    // first makes this throw.
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    expect(document.error.what).toContain('does not accept positional arguments')
    // Counted as well as parsed, so a future emitter that wrote one
    // document with a stray object inside it could not pass quietly.
    expect(result.stdout.match(/"schemaVersion"/g)).toHaveLength(1)
    expect(stderr).toBe('')
  })

  // The terminal check sits behind the flag conflict, so under `--json`
  // it is only reachable if that ordering ever changes. Its document
  // arm is the thing that keeps the promise when it does.
  test('the flag conflict, not the terminal, is the document a non-TTY gets', async () => {
    const { stderr, result } = await withTTY(false, () =>
      captureStderr(() => captureStdout(() => updateCommand.run([], { json: true, interactive: true }), { raw: true })),
    )

    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.error.what).toBe('facet update --json cannot be combined with --interactive')
    expect(result.stdout).not.toContain('needs an interactive terminal')
    expect(stderr).toBe('')
  })

  // `--interactive` alone on a non-TTY keeps its prose: there is no
  // document to protect, and the user is a human at a keyboard.
  test('--interactive without --json keeps the terminal error on stderr', async () => {
    const { stderr, result } = await withTTY(false, () =>
      captureStderr(() => updateCommand.run([], { interactive: true })),
    )

    expect(result).toBe(1)
    expect(stderr).toContain('facet update --interactive needs an interactive terminal')
  })
})

/**
 * Adapter discovery, with the real `ensureAdapters` in place.
 *
 * Every other test in this file stubs that function, which is why the
 * gap this closes survived: nothing exercised what it actually does. The
 * spy comes off here and only the engine's adapter loader is stubbed, so
 * the code between the command and the picker is the code that ships.
 */
describe('facet update — --json and adapter discovery', () => {
  type LoadAdapters = typeof engine.loadInstalledAdapters

  /**
   * Put the real `ensureAdapters` back for one test, with the engine's
   * loader answering `loaded` and the picker under a spy so a regression
   * mounts nothing and hangs nothing. The `ensureAdapters` spy is
   * re-installed afterwards — restoring retires it for good, and every
   * later test in this file needs a stub.
   */
  async function withRealAdapterDiscovery<T>(
    loaded: engine.LoadAdaptersResult,
    fn: (pickerInstallSpy: Mock<typeof pickerInstallModule.pickAndInstallAdapters>) => Promise<T>,
  ): Promise<T> {
    adaptersSpy.mockRestore()
    const loadSpy = spyOn(engine, 'loadInstalledAdapters') as unknown as Mock<LoadAdapters>
    loadSpy.mockResolvedValue(loaded)
    const pickerInstallSpy = spyOn(pickerInstallModule, 'pickAndInstallAdapters')
    pickerInstallSpy.mockResolvedValue({ ok: false, reason: 'aborted' })
    try {
      return await fn(pickerInstallSpy)
    } finally {
      pickerInstallSpy.mockRestore()
      loadSpy.mockRestore()
      adaptersSpy = spyOn(adapterModule, 'ensureAdapters')
    }
  }

  // On a TTY the picker is what a non-JSON run would open. A `--json`
  // run has a document on that stdout, so the picker must never be
  // reached at all — not opened and cancelled, not reached.
  test('zero adapters on a TTY is one document, and the picker is never mounted', async () => {
    preparing([BOUNDED])
    const { stderr, result, pickerCalled } = await withRealAdapterDiscovery(
      { ok: true, adapters: [] },
      async (pickerInstallSpy) => {
        const captured = await withTTY(true, () =>
          captureStderr(() => captureStdout(() => updateCommand.run([], { json: true }), { raw: true })),
        )
        return { ...captured, pickerCalled: pickerInstallSpy.mock.calls.length }
      },
    )

    expect(pickerCalled).toBe(0)
    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    expect(document.error.what).toBe('no adapters installed')
    expect(document.error.detail).toBe('this is a non-interactive environment; the picker cannot run here')
    expect(document.error.fix).toContain('first (e.g. claude-code, opencode)')
    expect(stderr).toBe('')
  })

  test('zero adapters off a TTY is the same document, and still exits 1', async () => {
    preparing([BOUNDED])
    const { stderr, result, pickerCalled } = await withRealAdapterDiscovery(
      { ok: true, adapters: [] },
      async (pickerInstallSpy) => {
        const captured = await withTTY(false, () =>
          captureStderr(() => captureStdout(() => updateCommand.run([], { json: true }), { raw: true })),
        )
        return { ...captured, pickerCalled: pickerInstallSpy.mock.calls.length }
      },
    )

    expect(pickerCalled).toBe(0)
    expect(result.result).toBe(1)
    expect(JSON.parse(result.stdout).error.what).toBe('no adapters installed')
    expect(stderr).toBe('')
  })

  const broken = (name: string): engine.InstalledAdapterFailure => ({
    kind: 'broken',
    name,
    managed: false,
    reason: { kind: 'invalid-receipt', detail: `${name} receipt is not readable` },
    repair: { kind: 'unmanaged-name', name },
  })

  // The loader reports one error per broken installation. Written
  // straight out, two of them would be two JSON values on one stream —
  // which no consumer can parse. Only the first is spoken.
  test('several broken adapters still produce exactly one document', async () => {
    preparing([BOUNDED])
    const { stderr, result } = await withRealAdapterDiscovery(
      { ok: false, failures: [broken('alpha'), broken('beta')] },
      () =>
        withTTY(false, () =>
          captureStderr(() => captureStdout(() => updateCommand.run([], { json: true }), { raw: true })),
        ),
    )

    expect(result.result).toBe(1)
    const document = JSON.parse(result.stdout)
    expect(document.ok).toBe(false)
    // One document, and it is the FIRST failure's.
    expect(result.stdout.match(/"schemaVersion"/g)).toHaveLength(1)
    expect(`${document.error.what} ${document.error.detail}`).toContain('alpha')
    expect(`${document.error.what} ${document.error.detail}`).not.toContain('beta')
    expect(stderr).toBe('')
  })

  // The other half of the contract: a run without `--json` still gets
  // the prose block, one per broken adapter, on stderr.
  test('without --json the same failures are still prose on stderr', async () => {
    preparing([BOUNDED])
    const { stderr, result } = await withRealAdapterDiscovery(
      { ok: false, failures: [broken('alpha'), broken('beta')] },
      (pickerInstallSpy) =>
        withTTY(false, async () => {
          const captured = await captureStderr(() => withSilencedStdout(() => updateCommand.run([], {})))
          expect(pickerInstallSpy).not.toHaveBeenCalled()
          return captured
        }),
    )

    expect(result).toBe(1)
    expect(stderr.match(/error:/g)).toHaveLength(2)
    for (const name of ['alpha', 'beta']) {
      expect(stderr).toContain(`installed adapter "${name}" has an invalid installation record`)
      expect(stderr).toContain(`${name} receipt is not readable`)
    }
  })
})

describe('facet update — JSON failure diagnostics', () => {
  const failures: { name: string; failure: engine.RunInstallFailure; expected: string }[] = [
    {
      name: 'MCP consent',
      failure: {
        code: 'MCP_CONSENT_REQUIRED',
        request: {
          declarations: [
            {
              identity: { kind: 'mcp-server', effectiveName: 'filesystem' },
              fingerprint: `sha256:${'a'.repeat(64)}`,
              declaration: { type: 'stdio', command: 'npx', args: ['srv'] },
              claimants: [{ facet: 'alpha', authoredName: 'filesystem', disposition: { kind: 'authored' } }],
              standing: { kind: 'unknown-identity' },
            },
          ],
          takeovers: [],
        },
      },
      expected: 'filesystem',
    },
    {
      name: 'invalid materialization alias',
      failure: {
        code: 'MATERIALIZATION_ALIAS_INVALID',
        problems: [
          {
            kind: 'asset',
            facet: 'alpha',
            assetType: 'skill',
            authoredName: 'review',
            alias: 'bad/name',
            reason: 'invalid name',
          },
        ],
      },
      expected: 'bad/name',
    },
  ]

  for (const { name, failure, expected } of failures) {
    test(`${name} and rollback paths stay in the error document`, async () => {
      preparing([BOUNDED])
      const runSpy = applying({
        ok: false,
        phase: 'install',
        install: {
          ok: false,
          failure,
          rollback: {
            kind: 'incomplete',
            restored: [],
            alreadyRestored: [],
            removedDirectories: [],
            issues: [
              {
                kind: 'restore-failed',
                path: '/project/contested.md',
                original: { kind: 'absent' },
                committed: { kind: 'absent' },
                failure: { operation: 'commit', path: '/project/contested.md', message: 'EIO' },
              },
            ],
          },
        },
      })
      try {
        const { stderr, result } = await captureStderr(() =>
          captureStdout(() => updateCommand.run([], { json: true }), { raw: true }),
        )
        expect(result.result).toBe(1)
        expect(stderr).toBe('')
        const document = JSON.parse(result.stdout)
        expect(document.ok).toBe(false)
        expect(document.error.detail).toContain(failure.code)
        expect(document.error.detail).toContain(expected)
        expect(document.error.detail).toContain('/project/contested.md')
        expect(document.error.detail).toContain('EIO')
      } finally {
        runSpy.mockRestore()
      }
    })
  }

  test('SIGINT aborts the engine without writing prose to stderr', async () => {
    preparing([BOUNDED])
    const runSpy = applying()
    runSpy.mockImplementation(async ({ signal }) => {
      process.emit('SIGINT')
      expect(signal?.aborted).toBe(true)
      return {
        ok: false,
        phase: 'install',
        install: {
          ok: false,
          failure: { code: 'ABORTED' },
          rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
        },
      }
    })
    try {
      const { stderr, result } = await captureStderr(() =>
        captureStdout(() => updateCommand.run([], { json: true }), { raw: true }),
      )
      expect(result.result).toBe(1)
      expect(stderr).toBe('')
      expect(JSON.parse(result.stdout).error.detail).toContain('ABORTED')
    } finally {
      runSpy.mockRestore()
    }
  })
})
