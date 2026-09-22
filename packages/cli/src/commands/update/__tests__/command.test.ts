import { afterAll, afterEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import * as engine from '@agent-facets/engine'
import { CURRENT_LOCKFILE_VERSION } from '@agent-facets/protocol'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import * as adapterModule from '../../shared/ensure-adapters.ts'
import { updateCommand } from '../index.ts'
import * as discoveryModule from '../run-discovery.ts'
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
})

/**
 * `--json` on every outcome this command reaches without applying
 * anything: a discovery failure, a no-op, and `--dry-run`.
 *
 * The one assertion nearly all of these share is `JSON.parse(stdout)`
 * off the raw capture. It is doing real work — a plan table, a prose
 * no-op line, or a stray spinner frame in front of the document all
 * make it throw, which is the whole promise `--json` makes.
 *
 * Nothing here touches the applying path. It still mounts Ink and
 * returns 0 with no document; that is a known intermediate state of
 * this stack and the next change's to fix, so asserting today's
 * behavior would only mean deleting the assertion later.
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
      captureStderr(() => updateCommand.run([], { json: true, interactive: true })),
    )

    expect(result).toBe(1)
    expect(stderr).toContain('facet update --json cannot be combined with --interactive')
    expect(stderr).not.toContain('needs an interactive terminal')
    // Refused before anything looked at the project or the registry.
    expect(prepareSpy).not.toHaveBeenCalled()
    expect(adaptersSpy).not.toHaveBeenCalled()
  })

  test('--json --interactive is refused on a real terminal too', async () => {
    const { stderr, result } = await withTTY(true, () =>
      captureStderr(() => updateCommand.run([], { json: true, interactive: true })),
    )

    expect(result).toBe(1)
    expect(stderr).toContain('facet update --json cannot be combined with --interactive')
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
})
