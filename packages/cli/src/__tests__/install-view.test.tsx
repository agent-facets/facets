import { describe, expect, test } from 'bun:test'
import type {
  AssetTakeoverDecision,
  AssetTakeoverRequest,
  CollisionFacetContribution,
  CollisionResolution,
  CollisionResolutionRequest,
  InstallSummary,
  McpConsentDecision,
  McpConsentRequest,
  McpInstallOutcomes,
  RollbackOutcome,
  RunInstallFailure,
  RunInstallResult,
  StageEvent,
} from '@agent-facets/engine'
import { assetIdentity, NO_ROLLBACK, planCollisionIntent } from '@agent-facets/engine'
import type { IntegrityFailure } from '@agent-facets/protocol'
import { CURRENT_LOCKFILE_VERSION, LOCKFILE_VERSION_0_3 } from '@agent-facets/protocol'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { InstallView, type InstallViewHooks, type InstallViewResult } from '../tui/views/install/install-view.tsx'
import { diskStateSentence } from '../util/install-outcome.ts'
import {
  describeUnsupportedManifestVersion,
  UNSUPPORTED_MANIFEST_VERSION_FIX,
  UNSUPPORTED_MANIFEST_VERSION_WHAT,
} from '../util/unsupported-manifest-version.ts'
import { visibleContentFrame, visibleTerminalText } from './helpers/terminal-output.ts'

/** An operation with no MCP work at all, which is every fixture below. */
const NO_MCP: McpInstallOutcomes = {
  consent: { kind: 'not-required' },
  dispositions: [],
  configurations: [],
  prunedIntent: [],
}

const NO_MCP_COUNTS: InstallSummary['mcp'] = {
  configurations: { added: 0, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
  declarations: { aliased: 0, omitted: 0 },
  takeovers: { accepted: 0 },
}

/**
 * Wait long enough for the view's `useEffect` chain to finish (run the
 * fake driver, set state for events, set the result, render, schedule
 * the deferred exit).
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

/**
 * A promise the test opens when it is ready.
 *
 * A fake driver must not hold a render phase open with a timer. The test is
 * waiting on its own timer, and the two are separated only by the gap between
 * `render()` returning and React flushing the effect that starts the driver —
 * sub-millisecond, and on the wrong side of it the driver has already resolved
 * and repainted before the assertion runs. A gate inverts that: the driver
 * cannot advance until the test says so, in any scheduling order.
 */
function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
  let open!: () => void
  const wait = new Promise<void>((resolve) => {
    open = () => resolve()
  })
  return { wait, open }
}

/**
 * Poll frames until `predicate` holds.
 *
 * The other half of the same problem: a gate stops the driver running ahead of
 * the assertion, and this stops the assertion running ahead of the paint. A
 * fixed sleep has to guess how long a render takes; this waits for the thing
 * it is actually waiting for.
 */
async function waitForFrame(
  instance: { lastFrame: () => string | undefined },
  predicate: (text: string) => boolean,
  description: string,
): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const text = visibleTerminalText(instance.lastFrame() ?? '')
    if (predicate(text)) return text
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${description}. Last frame:\n${instance.lastFrame() ?? '(none)'}`)
}

/**
 * Build a fake `run` driver that emits a canned event sequence and
 * resolves to a canned result. Lets each test exercise a specific
 * render path of `<InstallView />` without spinning up `runInstall`.
 */
function makeFakeRun(
  events: ReadonlyArray<StageEvent>,
  result: RunInstallResult,
): (hooks: InstallViewHooks) => Promise<RunInstallResult> {
  return async ({ onStage }) => {
    for (const event of events) {
      onStage(event)
    }
    return result
  }
}

/** A no-op successful run, for tests whose subject is an event rather than a result. */
function emptySuccess(): RunInstallResult {
  return {
    ok: true,
    lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
    summary: {
      facets: { installed: 0, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
      textAssets: { written: 0, removed: 0 },
      mcp: NO_MCP_COUNTS,
    },
    perFacet: [],
    mcp: NO_MCP,
  }
}

/**
 * {@link makeFakeRun} for the two results that never reach the install
 * pipeline: `add` and `remove` can fail while still preparing, and the view
 * renders a different block for each.
 */
function makeFakePrepareRun(result: InstallViewResult): () => Promise<InstallViewResult> {
  return async () => result
}

const successResultSingle: RunInstallResult = {
  ok: true,
  lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
  summary: {
    facets: { installed: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
    textAssets: { written: 3, removed: 0 },
    mcp: NO_MCP_COUNTS,
  },
  perFacet: [{ kind: 'installed', name: 'viper-plans', version: '1.2.3' }],
  mcp: NO_MCP,
}

const successResultMulti: RunInstallResult = {
  ok: true,
  lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
  summary: {
    facets: { installed: 2, updated: 1, repaired: 0, unchanged: 0, removed: 0 },
    textAssets: { written: 9, removed: 0 },
    mcp: NO_MCP_COUNTS,
  },
  perFacet: [
    { kind: 'installed', name: 'viper-plans', version: '1.2.3' },
    { kind: 'installed', name: 'rezi', version: '0.5.0' },
    { kind: 'updated', name: 'planner', oldVersion: '1.0.0', newVersion: '2.0.0' },
  ],
  mcp: NO_MCP,
}

const successResultNoOp: RunInstallResult = {
  ok: true,
  lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
  summary: {
    facets: { installed: 0, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
    textAssets: { written: 0, removed: 0 },
    mcp: NO_MCP_COUNTS,
  },
  perFacet: [],
  mcp: NO_MCP,
}

describe('InstallView — single-facet success', () => {
  test('renders header and one facet success row', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'viper-plans', specifier: './local-plans' },
      { kind: 'facet-stage', facet: 'viper-plans', stage: 'build' },
      {
        kind: 'facet-success',
        facet: 'viper-plans',
        outcome: { kind: 'installed', name: 'viper-plans', version: '1.2.3' },
      },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, successResultSingle),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('viper-plans installed.')
    expect(frame).toContain('1 installed')
    instance.unmount()
  })
})

describe('InstallView — multi-facet success with update', () => {
  test('renders one row per facet and includes (was X → Y) for updates', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 3 },
      { kind: 'facet-start', facet: 'viper-plans', specifier: 'github:a/v' },
      {
        kind: 'facet-success',
        facet: 'viper-plans',
        outcome: { kind: 'installed', name: 'viper-plans', version: '1.2.3' },
      },
      { kind: 'facet-start', facet: 'rezi', specifier: 'github:a/r' },
      {
        kind: 'facet-success',
        facet: 'rezi',
        outcome: { kind: 'installed', name: 'rezi', version: '0.5.0' },
      },
      { kind: 'facet-start', facet: 'planner', specifier: 'github:a/p' },
      {
        kind: 'facet-success',
        facet: 'planner',
        outcome: { kind: 'updated', name: 'planner', oldVersion: '1.0.0', newVersion: '2.0.0' },
      },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, successResultMulti),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('Install complete.')
    expect(frame).toContain('2 installed')
    expect(frame).toContain('1 updated')
    instance.unmount()
  })
})

describe('InstallView — drift removal', () => {
  test('renders a removal line when a facet is dropped from facets.json', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 0 },
      { kind: 'drift-removal', facet: 'orphan', oldVersion: '1.0.0' },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 0, updated: 0, repaired: 0, unchanged: 0, removed: 1 },
        textAssets: { written: 0, removed: 2 },
        mcp: NO_MCP_COUNTS,
      },
      perFacet: [{ kind: 'removed', name: 'orphan', oldVersion: '1.0.0' }],
      mcp: NO_MCP,
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('1 removed')
    instance.unmount()
  })

  // "removed" with the files still on disk is the one summary a user cannot
  // check against the file tree, so the reason has to be on screen.
  test('says the files were kept when a removal was untracked', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 0 },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 0, updated: 0, repaired: 0, unchanged: 0, removed: 1 },
        textAssets: { written: 0, removed: 0 },
        mcp: NO_MCP_COUNTS,
      },
      perFacet: [{ kind: 'removed-untracked', name: 'orphan', oldVersion: '1.0.0' }],
      mcp: NO_MCP,
    }
    const instance = render(createElement(InstallView, { mode: 'remove', run: makeFakeRun(events, result) }))
    await settle()
    const frame = visibleContentFrame(instance.frames)
    // Still named as removed — the declaration did go away.
    expect(frame).toContain('orphan')
    // Ink wraps at the test terminal width, so assert on wrap-safe fragments.
    expect(frame).toContain('left in place')
    expect(frame).toContain('manually')
    // The remedy must be one that still works from here. `facet install`
    // does not: the facet is already out of `facets.json`.
    expect(frame).not.toContain('facet install')
    instance.unmount()
  })

  test('warns when the receipt exists but cannot be used', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 0 },
      { kind: 'receipt-unavailable', reason: 'corrupt' },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 0, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
        textAssets: { written: 0, removed: 0 },
        mcp: NO_MCP_COUNTS,
      },
      perFacet: [],
      mcp: NO_MCP,
    }
    const instance = render(createElement(InstallView, { mode: 'install', run: makeFakeRun(events, result) }))
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('unreadable')
    expect(frame).toContain('nothing already on disk is tracked')
    instance.unmount()
  })

  test('names the other unusable-receipt reason distinctly', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(
          [
            { kind: 'install-start', totalFacets: 0 },
            { kind: 'receipt-unavailable', reason: 'path-mismatch' },
            { kind: 'install-complete', outcome: 'success' },
          ],
          emptySuccess(),
        ),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('different project')
    expect(frame).not.toContain('unreadable')
    instance.unmount()
  })

  test('warns when a receipt entry was rejected, naming what stays behind', async () => {
    // Verbose-only would hide a cleanup that will never happen.
    const instance = render(
      createElement(InstallView, {
        mode: 'remove',
        run: makeFakeRun(
          [
            { kind: 'install-start', totalFacets: 0 },
            { kind: 'receipt-invalid-asset', facet: 'alpha', asset: 'review', reason: 'owned path escapes' },
            { kind: 'install-complete', outcome: 'success' },
          ],
          emptySuccess(),
        ),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('review')
    expect(frame).toContain('alpha')
    expect(frame).toContain('left in place')
    instance.unmount()
  })

  test('warns when assets were written but the receipt could not be', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(
          [
            { kind: 'install-start', totalFacets: 0 },
            { kind: 'receipt-unpersisted', cause: 'EACCES', residue: NO_ROLLBACK },
            { kind: 'install-complete', outcome: 'success' },
          ],
          emptySuccess(),
        ),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('could not be written')
    expect(frame).toContain('untracked')
    instance.unmount()
  })

  // The run succeeded, and still left a file it could not put back. Reporting
  // the success without the path would strand the user with neither.
  test('names a receipt path the failed write could not put back', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(
          [
            { kind: 'install-start', totalFacets: 0 },
            {
              kind: 'receipt-unpersisted',
              cause: 'EIO',
              residue: {
                kind: 'incomplete',
                restored: [],
                alreadyRestored: [],
                removedDirectories: [],
                issues: [
                  {
                    kind: 'restore-failed',
                    path: '/facet/receipts/proj-abc.json',
                    original: { kind: 'absent' },
                    committed: { kind: 'absent' },
                    failure: { operation: 'delete', path: '/facet/receipts/proj-abc.json', message: 'EIO' },
                  },
                ],
              },
            },
            { kind: 'install-complete', outcome: 'success' },
          ],
          emptySuccess(),
        ),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('could not be put back')
    instance.unmount()
  })
})

describe('InstallView — marketing aesthetic on `add`', () => {
  test('renders bundle viz line and "Now /<cmd> is available" landing line', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'cowsay', specifier: 'cowsay@latest' },
      {
        kind: 'facet-success',
        facet: 'cowsay',
        outcome: { kind: 'installed', name: 'cowsay', version: '0.1.0' },
      },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const result: RunInstallResult = {
      ok: true,
      lockfile: {
        lockfileVersion: LOCKFILE_VERSION_0_3,
        facets: {
          cowsay: {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '0.1.0',
            integrity: 'sha256:x',
            assets: [
              {
                scope: 'project',
                type: 'command',
                name: 'cowsay',
                materialization: { kind: 'authored' },
                files: [{ path: 'commands/cowsay.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
              {
                scope: 'project',
                type: 'skill',
                name: 'ascii-art',
                materialization: { kind: 'authored' },
                files: [{ path: 'skills/ascii-art/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
            ],
          },
        },
      },
      summary: {
        facets: { installed: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
        textAssets: { written: 2, removed: 0 },
        mcp: NO_MCP_COUNTS,
      },
      perFacet: [{ kind: 'installed', name: 'cowsay', version: '0.1.0' }],
      mcp: NO_MCP,
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('1 skill')
    expect(frame).toContain('1 command')
    // The "Now /x is available" line was removed in the marketing overhaul.
    expect(frame).not.toContain('is available to your agents')
    instance.unmount()
  })

  test('omits the landing line when no command asset shipped', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'pure-skills', specifier: 'pure-skills@1.0.0' },
      {
        kind: 'facet-success',
        facet: 'pure-skills',
        outcome: { kind: 'installed', name: 'pure-skills', version: '1.0.0' },
      },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const result: RunInstallResult = {
      ok: true,
      lockfile: {
        lockfileVersion: LOCKFILE_VERSION_0_3,
        facets: {
          'pure-skills': {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '1.0.0',
            integrity: 'sha256:x',
            assets: [
              {
                scope: 'project',
                type: 'skill',
                name: 'planning',
                materialization: { kind: 'authored' },
                files: [{ path: 'skills/planning/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
            ],
          },
        },
      },
      summary: {
        facets: { installed: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
        textAssets: { written: 1, removed: 0 },
        mcp: NO_MCP_COUNTS,
      },
      perFacet: [{ kind: 'installed', name: 'pure-skills', version: '1.0.0' }],
      mcp: NO_MCP,
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('1 skill')
    expect(frame).not.toContain('is available to your agents')
    instance.unmount()
  })

  test("counts only THIS run's facets, not pre-existing lockfile entries", async () => {
    // Regression for the PR review finding: when `facet add cowsay` runs
    // against a project that already has `existing-skill` in the lockfile,
    // the bundle viz must show only cowsay's assets — not the project total.
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'cowsay', specifier: 'cowsay@latest' },
      {
        kind: 'facet-success',
        facet: 'cowsay',
        outcome: { kind: 'installed', name: 'cowsay', version: '0.1.0' },
      },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const result: RunInstallResult = {
      ok: true,
      lockfile: {
        lockfileVersion: LOCKFILE_VERSION_0_3,
        facets: {
          // pre-existing — must NOT appear in the count
          'existing-skill': {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '1.0.0',
            integrity: 'sha256:y',
            assets: [
              {
                scope: 'project',
                type: 'skill',
                name: 'old-skill-a',
                materialization: { kind: 'authored' },
                files: [{ path: 'skills/old-skill-a/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
              {
                scope: 'project',
                type: 'skill',
                name: 'old-skill-b',
                materialization: { kind: 'authored' },
                files: [{ path: 'skills/old-skill-b/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
              {
                scope: 'project',
                type: 'command',
                name: 'old-command',
                materialization: { kind: 'authored' },
                files: [{ path: 'commands/old-command.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
            ],
          },
          // newly installed this run
          cowsay: {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '0.1.0',
            integrity: 'sha256:x',
            assets: [
              {
                scope: 'project',
                type: 'command',
                name: 'cowsay',
                materialization: { kind: 'authored' },
                files: [{ path: 'commands/cowsay.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
            ],
          },
        },
      },
      summary: {
        facets: { installed: 1, updated: 0, repaired: 0, unchanged: 1, removed: 0 },
        textAssets: { written: 1, removed: 0 },
        mcp: NO_MCP_COUNTS,
      },
      perFacet: [
        { kind: 'installed', name: 'cowsay', version: '0.1.0' },
        // pre-existing — `unchanged` must NOT contribute to the bundle viz
        { kind: 'unchanged', name: 'existing-skill', version: '1.0.0' },
      ],
      mcp: NO_MCP,
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    // Only cowsay's one command — no skills from `existing-skill`.
    expect(frame).toContain('1 command')
    expect(frame).not.toContain('skill')
    // The "Now /x is available" line was removed in the marketing overhaul.
    expect(frame).not.toContain('is available to your agents')
    expect(frame).not.toContain('old-command')
    instance.unmount()
  })

  test('skips the landing line on `mode: install` even when commands shipped', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'cowsay', specifier: 'cowsay@latest' },
      {
        kind: 'facet-success',
        facet: 'cowsay',
        outcome: { kind: 'installed', name: 'cowsay', version: '0.1.0' },
      },
    ]
    const result: RunInstallResult = {
      ok: true,
      lockfile: {
        lockfileVersion: LOCKFILE_VERSION_0_3,
        facets: {
          cowsay: {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '0.1.0',
            integrity: 'sha256:x',
            assets: [
              {
                scope: 'project',
                type: 'command',
                name: 'cowsay',
                materialization: { kind: 'authored' },
                files: [{ path: 'commands/cowsay.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
            ],
          },
        },
      },
      summary: {
        facets: { installed: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
        textAssets: { written: 1, removed: 0 },
        mcp: NO_MCP_COUNTS,
      },
      perFacet: [{ kind: 'installed', name: 'cowsay', version: '0.1.0' }],
      mcp: NO_MCP,
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('1 command')
    expect(frame).not.toContain('is available to your agents')
    instance.unmount()
  })
})

describe('InstallView — empty / no-op', () => {
  test('renders the no-op message when nothing changes', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 0 },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, successResultNoOp),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('no changes')
    instance.unmount()
  })
})

describe('InstallView — integrity failure', () => {
  test('renders the integrity failure block with check label and hashes', async () => {
    const integrityFailure: IntegrityFailure = {
      kind: 'facet',
      facet: 'viper-plans',
      check: 'B',
      expected: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      observed: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }
    const failure: RunInstallFailure = {
      code: 'INTEGRITY_FAILURE',
      failure: integrityFailure,
    }
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'viper-plans', specifier: 'github:a/v' },
      { kind: 'facet-failure', facet: 'viper-plans', failure },
    ]
    const result: RunInstallResult = {
      ok: false,
      failure,
      rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('integrity check failed')
    expect(frame).toContain('check: B')
    expect(frame).toContain(integrityFailure.expected)
    expect(frame).toContain(integrityFailure.observed)
    expect(frame).toContain(diskStateSentence({ kind: 'not-needed', reason: 'post-lock-no-mutation' }))
    instance.unmount()
  })

  // 9.8: pre-materialization per-file reconciliation failures render with the
  // exact drifting path and both hashes.
  test('renders a per-file reconcile failure with the exact path', async () => {
    const failure: RunInstallFailure = {
      code: 'RECONCILE_PER_FILE_INTEGRITY',
      facet: 'viper-plans',
      asset: 'skill:planning',
      path: 'skills/planning/references/api.md',
      expected: `sha256:${'a'.repeat(64)}`,
      actual: `sha256:${'b'.repeat(64)}`,
    }
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'viper-plans', specifier: 'github:a/v' },
      { kind: 'facet-failure', facet: 'viper-plans', failure },
    ]
    const result: RunInstallResult = {
      ok: false,
      failure,
      rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
    }
    const instance = render(createElement(InstallView, { mode: 'add', run: makeFakeRun(events, result) }))
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('file integrity mismatch')
    expect(frame).toContain('skills/planning/references/api.md')
    expect(frame).toContain(failure.code === 'RECONCILE_PER_FILE_INTEGRITY' ? failure.expected : '')
    instance.unmount()
  })
})

describe('InstallView — parse error failure', () => {
  test('renders parse error with fix copy', async () => {
    const failure: RunInstallFailure = {
      code: 'PARSE_ERROR',
      facet: 'broken',
      specifier: 'git+https://example.com/repo.git',
      error: {
        code: 'GIT_PLUS_PREFIX',
        what: 'git+ prefix is not supported',
        fix: 'use https://...git, ssh://..., or git@host:owner/repo without the git+ prefix',
      },
    }
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'broken', specifier: 'git+https://example.com/repo.git' },
      { kind: 'facet-failure', facet: 'broken', failure },
    ]
    const result: RunInstallResult = {
      ok: false,
      failure,
      rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('could not parse source for broken')
    expect(frame).toContain('git+ prefix is not supported')
    expect(frame).toContain('fix:')
    instance.unmount()
  })
})

describe('InstallView — aborted', () => {
  // An abort reaches all three rollback outcomes: before any mutation, after
  // a clean rollback, and after one that could not finish. The block used to
  // claim "Rolled back to pre-install state" for every one of them, and the
  // `not-needed` case was the common one (Ctrl-C during fetch).
  const rollbacks: RollbackOutcome[] = [
    { kind: 'not-needed', reason: 'post-lock-no-mutation' },
    { kind: 'complete', restored: ['/tmp/a'], alreadyRestored: [], removedDirectories: [] },
    {
      kind: 'incomplete',
      restored: ['/tmp/a'],
      alreadyRestored: [],
      removedDirectories: [],
      issues: [
        {
          kind: 'conflict',
          path: '/tmp/contested.md',
          original: { kind: 'absent' },
          committed: { kind: 'absent' },
          observed: { kind: 'absent' },
        },
      ],
    },
  ]

  test.each(rollbacks)('states what $kind rollback left on disk', async (rollback) => {
    const failure: RunInstallFailure = { code: 'ABORTED' }
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'install-complete', outcome: 'aborted' },
    ]
    const result: RunInstallResult = { ok: false, failure, rollback }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('install aborted')
    // Asserted against the shared helper rather than a literal: this is the
    // check that the view and the stderr `fix:` line cannot drift apart.
    expect(frame).toContain(diskStateSentence(rollback))
    // And exactly one of the three, so a block that emitted all of them —
    // which is what rendering every branch unconditionally would look like —
    // cannot pass on the `toContain` above alone.
    for (const other of rollbacks.filter((r) => r.kind !== rollback.kind)) {
      expect(frame).not.toContain(diskStateSentence(other))
    }
    instance.unmount()
  })
})

describe('InstallView — unsupported manifest version', () => {
  // The words come from the CLI's shared module; asserting against the
  // constants rather than literals is what stops a `.tsx` edit from
  // reintroducing a fourth phrasing without failing anything.
  const detail = { path: '/p/facets.json', supported: [0.1] }

  test.each([
    ['a numeric version', 0.9 as number | undefined],
    ['a non-numeric version', undefined as number | undefined],
  ])('the install-phase block renders %s through the shared module', async (_label, observed) => {
    const failure: RunInstallFailure = { code: 'FACETS_JSON_UNSUPPORTED_VERSION', ...detail, observed }
    const result: RunInstallResult = {
      ok: false,
      failure,
      rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun([{ kind: 'install-complete', outcome: 'failure' }], result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain(UNSUPPORTED_MANIFEST_VERSION_WHAT)
    expect(frame).toContain(UNSUPPORTED_MANIFEST_VERSION_FIX)
    expect(frame).toContain(describeUnsupportedManifestVersion({ ...detail, observed }))
    // The remedy is the opposite of the malformed-manifest one, and the
    // block that used to render here got it backwards.
    expect(frame).not.toContain('fix the underlying issue')
    instance.unmount()
  })

  const prepareFailure = { reason: 'manifest-unsupported-version', ...detail, observed: 0.9 } as const
  const prepareResults: Array<['add' | 'remove', InstallViewResult]> = [
    ['add', { ok: false, prepareFailure }],
    ['remove', { ok: false, removePrepareFailure: prepareFailure }],
  ]

  test.each(prepareResults)('the %s prepare block renders the same words', async (mode, result) => {
    const instance = render(
      createElement(InstallView, {
        mode,
        run: makeFakePrepareRun(result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain(UNSUPPORTED_MANIFEST_VERSION_WHAT)
    expect(frame).toContain(UNSUPPORTED_MANIFEST_VERSION_FIX)
    instance.unmount()
  })
})

describe('InstallView — partial rollback failure surfaces', () => {
  test('renders rollback partial-failure note when present', async () => {
    const failure: RunInstallFailure = {
      code: 'ADAPTER_INSTALL_FAILED',
      facet: 'viper-plans',
      adapter: 'opencode',
      asset: assetIdentity('project', 'skill', 'planning'),
      cause: 'disk full',
    }
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'viper-plans', specifier: './fixture' },
      { kind: 'facet-failure', facet: 'viper-plans', failure },
    ]
    const rollback: RollbackOutcome = {
      kind: 'incomplete',
      restored: ['/tmp/a'],
      alreadyRestored: [],
      removedDirectories: [],
      issues: [
        {
          kind: 'conflict',
          path: '/tmp/contested.md',
          original: { kind: 'absent' },
          committed: { kind: 'absent' },
          observed: { kind: 'absent' },
        },
      ],
    }
    const result: RunInstallResult = { ok: false, failure, rollback }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain(diskStateSentence(rollback))
    expect(frame).toContain('changed by something else')
    expect(frame).toContain('disk full')
    instance.unmount()
  })
})

describe('InstallView — adapter registration', () => {
  test('renders adapter count when adapter-complete events are emitted', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'cowsay', specifier: 'cowsay@latest' },
      { kind: 'facet-stage', facet: 'cowsay', stage: 'materialize' },
      { kind: 'adapter-complete', facet: 'cowsay', adapter: 'claude-code' },
      { kind: 'adapter-complete', facet: 'cowsay', adapter: 'opencode' },
      {
        kind: 'facet-success',
        facet: 'cowsay',
        outcome: { kind: 'installed', name: 'cowsay', version: '0.1.0' },
      },
      { kind: 'install-complete', outcome: 'success' },
    ]
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, successResultSingle),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    // Registration line: "Updated facets via 2 adapters"
    expect(frame).toContain('Updated facets via')
    expect(frame).toContain('2 adapter')
    // Timer line: "across 2 adapters"
    expect(frame).toContain('across')
    instance.unmount()
  })
})

describe('InstallView — frozen-lockfile drift', () => {
  test('renders each drifting facet with its reason', async () => {
    const failure: RunInstallFailure = {
      code: 'LOCKFILE_DRIFT',
      facets: [
        { name: 'cowsay', reason: 'unsatisfied', manifestSpec: '0.1.2', lockedVersion: '0.1.1' },
        { name: 'extra', reason: 'no-entry', manifestSpec: '0.2.0' },
        { name: 'stale', reason: 'orphaned', lockedVersion: '4.5.6' },
        {
          name: 'planner',
          reason: 'source-changed',
          manifestSpec: 'github:attacker/planner',
          lockedSource: 'github:agent-facets/planner',
        },
      ],
    }
    const events: StageEvent[] = [{ kind: 'install-complete', outcome: 'failure' }]
    const result: RunInstallResult = {
      ok: false,
      failure,
      rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('lockfile is out of date')
    expect(frame).toContain('locked 0.1.1 does not satisfy 0.1.2')
    expect(frame).toContain('not in lockfile (manifest wants 0.2.0)')
    expect(frame).toContain('in lockfile but not in facets.json (locked 4.5.6)')
    expect(frame).toContain('source changed: locked github:agent-facets/planner')
    expect(frame).toContain('without --frozen-lockfile')
    instance.unmount()
  })

  // The load-bearing half of frozen stale intent: a normal install prunes the
  // override and says so, frozen refuses and must say the opposite. Reporting
  // it without that clause would read as "handled".
  test('a stale server override says the override was not removed', async () => {
    const failure: RunInstallFailure = {
      code: 'LOCKFILE_DRIFT',
      facets: [
        {
          name: 'mcp-tools',
          reason: 'stale-override',
          contribution: { kind: 'mcp-server' },
          authoredName: 'gone',
        },
      ],
    }
    const events: StageEvent[] = [{ kind: 'install-complete', outcome: 'failure' }]
    const result: RunInstallResult = {
      ok: false,
      failure,
      rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('gone')
    expect(frame).toContain('NOT removed')
    instance.unmount()
  })
})

// ---------------------------------------------------------------------------
// Collision resolution: the workspace phase inside the same Ink mount
// ---------------------------------------------------------------------------

const KEY = { down: '\u001B[B', right: '\u001B[C', enter: '\r', escape: '\u001B' } as const

function collisionRequest(): CollisionResolutionRequest {
  // Planner contributions are AUTHORED assets — identity only. They carry no
  // disposition or file records, unlike a lockfile entry.
  const facets: CollisionFacetContribution[] = [
    { facet: 'alpha', assets: [{ scope: 'project', type: 'skill', name: 'review' }], servers: [] },
    { facet: 'beta', assets: [{ scope: 'project', type: 'skill', name: 'review' }], servers: [] },
  ]
  const planned = planCollisionIntent(facets, {})
  if (planned.ok || planned.reason !== 'collision') expect.unreachable()
  return { groups: planned.groups, facets, overrides: {}, staleOverrides: [] }
}

const CANCELLED_RESULT: RunInstallResult = {
  ok: false,
  failure: { code: 'MATERIALIZATION_CANCELLED' },
  rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
}

/**
 * A driver that behaves like the engine around a collision: emit
 * progress, block on the resolver, then continue or fail based on what
 * came back. Records the resolution so tests can assert on the exact
 * value the engine would have received.
 */
function makeResolvingRun(
  request: CollisionResolutionRequest,
  onResolution: (resolution: CollisionResolution) => void,
  resolvedResult: RunInstallResult = successResultSingle,
) {
  return async ({ onStage, resolveCollisions }: InstallViewHooks): Promise<RunInstallResult> => {
    onStage({ kind: 'install-start', totalFacets: 2 })
    onStage({ kind: 'collision-check' })
    const resolution = await resolveCollisions(request)
    onResolution(resolution)
    if (resolution.kind === 'cancelled') return CANCELLED_RESULT
    onStage({ kind: 'facet-start', facet: 'alpha', specifier: './alpha' })
    onStage({ kind: 'facet-stage', facet: 'alpha', stage: 'materialize' })
    return resolvedResult
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

describe('InstallView — collision phase machine', () => {
  test('the collision check is a visible stage, not a stall', async () => {
    const checking = gate()
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: async ({ onStage }) => {
          onStage({ kind: 'install-start', totalFacets: 2 })
          onStage({ kind: 'collision-check' })
          await checking.wait
          return successResultSingle
        },
      }),
    )

    await waitForFrame(instance, (text) => text.includes('Checking for name collisions'), 'the collision stage')

    checking.open()
    await settle()
    instance.unmount()
  })

  // Collision checking is evaluated once over the COMPLETE desired set, not
  // per facet. A rendering that showed it for one facet and skipped it for
  // several would misdescribe when the check happens — and the spec's
  // single-facet scenario named it while the multi-facet one did not.
  test('the same single global phase is shown for a multi-facet run', async () => {
    const checking = gate()
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: async ({ onStage }) => {
          onStage({ kind: 'install-start', totalFacets: 2 })
          for (const facet of ['alpha', 'beta']) {
            onStage({ kind: 'facet-start', facet, specifier: `./${facet}` })
            onStage({ kind: 'facet-stage', facet, stage: 'verify' })
          }
          onStage({ kind: 'collision-check' })
          await checking.wait
          return successResultSingle
        },
      }),
    )

    const paused = await waitForFrame(
      instance,
      (text) => text.includes('Checking for name collisions across all facets'),
      'the collision stage',
    )
    // One phase, not one per facet.
    expect(paused.match(/Checking for name collisions/g)).toHaveLength(1)

    checking.open()
    await settle()
    instance.unmount()
  })

  test('the collision phase clears once materialization starts', async () => {
    const checking = gate()
    const materializing = gate()
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: async ({ onStage }) => {
          onStage({ kind: 'install-start', totalFacets: 2 })
          onStage({ kind: 'facet-start', facet: 'alpha', specifier: './alpha' })
          onStage({ kind: 'collision-check' })
          await checking.wait
          onStage({ kind: 'facet-stage', facet: 'alpha', stage: 'materialize' })
          await materializing.wait
          return successResultSingle
        },
      }),
    )

    // Held open, so the phase cannot have come and gone before this runs.
    await waitForFrame(instance, (text) => text.includes('Checking for name collisions'), 'the collision stage')

    checking.open()
    await waitForFrame(
      instance,
      (text) => !text.includes('Checking for name collisions'),
      'the collision stage to clear',
    )

    materializing.open()

    await settle()
    instance.unmount()
  })

  test('progress gives way to the workspace and comes back, in one mount', async () => {
    const resolutions: CollisionResolution[] = []
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeResolvingRun(collisionRequest(), (r) => resolutions.push(r)),
      }),
    )
    await tick()

    // Phase 2: the workspace has the screen.
    expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('Installation is paused')

    // Resolve by omitting both claimants, then confirm.
    for (const key of [
      KEY.enter,
      KEY.right,
      KEY.right,
      KEY.enter,
      KEY.down,
      KEY.right,
      KEY.right,
      KEY.enter,
      KEY.escape,
      KEY.down,
      KEY.enter,
    ]) {
      instance.stdin.write(key)
      await tick()
    }

    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]?.kind).toBe('resolved')

    // Phase 3 and 4: progress resumed and the result rendered — no
    // second Ink renderer, so the whole run is one continuous frame
    // stream.
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('Install complete.')
    expect(frame).toContain('1 installed')
    instance.unmount()
  })

  test('cancelling shows the cancellation block and no success summary', async () => {
    const resolutions: CollisionResolution[] = []
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeResolvingRun(collisionRequest(), (r) => resolutions.push(r)),
      }),
    )
    await tick()
    instance.stdin.write(KEY.escape)
    await settle()

    expect(resolutions).toEqual([{ kind: 'cancelled' }])
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('Cancelled')
    expect(frame).toContain(diskStateSentence({ kind: 'not-needed', reason: 'post-lock-no-mutation' }))
    expect(frame).not.toContain('Install complete.')
    instance.unmount()
  })

  test('an interrupt while the workspace is open settles the pending prompt', async () => {
    // The engine is holding the project lock and awaiting this promise.
    // If an interrupt left it unsettled, the lock would never be
    // released and the process would hang instead of exiting.
    const controller = new AbortController()
    const resolutions: CollisionResolution[] = []
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        signal: controller.signal,
        run: makeResolvingRun(collisionRequest(), (r) => resolutions.push(r)),
      }),
    )
    await tick()
    expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('Installation is paused')

    controller.abort()
    await settle()

    expect(resolutions).toEqual([{ kind: 'cancelled' }])
    instance.unmount()
  })
})

describe('InstallView — materialization reporting', () => {
  const lockfileWithDispositions: RunInstallResult = {
    ok: true,
    lockfile: {
      lockfileVersion: LOCKFILE_VERSION_0_3,
      facets: {
        alpha: {
          source: { kind: 'local', path: './alpha' },
          version: '1.0.0',
          integrity: 'sha256:aaaa',
          assets: [
            {
              scope: 'project',
              type: 'skill',
              name: 'review',
              materialization: { kind: 'aliased', as: 'vendor-review' },
              files: [{ path: 'skills/review/SKILL.md', integrity: 'sha256:bbbb' }],
            },
            {
              scope: 'project',
              type: 'command',
              name: 'deploy',
              materialization: { kind: 'omitted' },
              files: [{ path: 'commands/deploy.md', integrity: 'sha256:cccc' }],
            },
          ],
        },
      },
    },
    summary: {
      facets: { installed: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
      textAssets: { written: 1, removed: 0 },
      mcp: NO_MCP_COUNTS,
    },
    perFacet: [{ kind: 'installed', name: 'alpha', version: '1.0.0' }],
    mcp: NO_MCP,
  }

  test('shows the authored name beside the effective name, and marks omissions', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], lockfileWithDispositions),
      }),
    )
    await settle()

    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('review')
    expect(frame).toContain('vendor-review')
    expect(frame).toContain('deploy')
    expect(frame).toContain('omitted')
    instance.unmount()
  })

  test('an omitted asset is not counted as materialized', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], lockfileWithDispositions),
      }),
    )
    await settle()

    // The omitted command stays in the lockfile — it is part of the
    // resolved set — but claiming it in the bundle would advertise a
    // file that was never written.
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('1 skill')
    expect(frame).not.toContain('1 command')
    instance.unmount()
  })

  test('a pruned stale override is reported without --verbose', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(
          [
            { kind: 'install-start', totalFacets: 1 },
            {
              kind: 'stale-override-pruned',
              facet: 'alpha',
              contribution: { kind: 'asset', assetType: 'skill' },
              authoredName: 'gone',
            },
          ],
          successResultSingle,
        ),
      }),
    )
    await settle()

    // No `onLog` was supplied — this has to be visible anyway, because
    // it silently changed what facets.json says.
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('gone')
    expect(frame).toContain('alpha')
    expect(frame).toContain('no longer contains')
    instance.unmount()
  })

  test('a pruned server override names the server, not an asset type', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(
          [
            { kind: 'install-start', totalFacets: 1 },
            {
              kind: 'stale-override-pruned',
              facet: 'mcp-tools',
              contribution: { kind: 'mcp-server' },
              authoredName: 'gone',
            },
          ],
          successResultSingle,
        ),
      }),
    )
    await settle()

    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('gone')
    expect(frame).toContain('mcp-tools')
    expect(frame).toContain('server')
    instance.unmount()
  })
})

describe('InstallView — disposition-only change', () => {
  test('is summarised as an update, without a version-to-itself arrow', async () => {
    // The facet did not move; its materialization did. Reporting a
    // repair would claim the disk had drifted, and printing
    // "was 1.0.0 → 1.0.0" would read as a bug in the version resolver.
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 0, updated: 1, repaired: 0, unchanged: 0, removed: 0 },
        textAssets: { written: 1, removed: 0 },
        mcp: NO_MCP_COUNTS,
      },
      perFacet: [{ kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' }],
      mcp: NO_MCP,
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], result),
      }),
    )
    await settle()

    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('1 updated')
    expect(frame).not.toContain('repaired')
    expect(frame).not.toContain('1.0.0 → 1.0.0')
    instance.unmount()
  })
})

describe('InstallView — MCP configuration outcomes', () => {
  // A server-only facet writes no file. Reporting "no changes" over a run
  // that rewrote a tool's config is exactly what the separate counts exist
  // to prevent.
  test('a server-only facet is not a no-op', async () => {
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
        textAssets: { written: 0, removed: 0 },
        mcp: {
          configurations: { added: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
          declarations: { aliased: 0, omitted: 0 },
          takeovers: { accepted: 0 },
        },
      },
      perFacet: [{ kind: 'installed', name: 'alpha', version: '1.0.0' }],
      mcp: {
        consent: { kind: 'not-required' },
        dispositions: [{ kind: 'authored', facet: 'alpha', authoredName: 'filesystem', change: 'introduced' }],
        configurations: [
          {
            kind: 'active',
            adapter: 'claude-code',
            effectiveName: 'filesystem',
            claimants: ['alpha'],
            status: 'added',
            takenOver: false,
          },
        ],
        prunedIntent: [],
      },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], result),
      }),
    )
    await settle()

    const frame = visibleContentFrame(instance.frames)
    expect(frame).not.toContain('no changes')
    expect(frame).toContain('0 assets written')
    expect(frame).toContain('1 server config added')
    expect(frame).toContain('MCP server filesystem added in claude-code')
    instance.unmount()
  })

  test('an alias shows both names and an omission is named', async () => {
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
        textAssets: { written: 0, removed: 0 },
        mcp: {
          configurations: { added: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0 },
          declarations: { aliased: 1, omitted: 1 },
          takeovers: { accepted: 0 },
        },
      },
      perFacet: [{ kind: 'installed', name: 'alpha', version: '1.0.0' }],
      mcp: {
        consent: { kind: 'not-required' },
        dispositions: [
          {
            kind: 'aliased',
            facet: 'alpha',
            authoredName: 'filesystem',
            effectiveName: 'project-filesystem',
            change: 'introduced',
          },
          { kind: 'omitted', facet: 'alpha', authoredName: 'docs', change: 'introduced' },
        ],
        configurations: [
          {
            kind: 'active',
            adapter: 'claude-code',
            effectiveName: 'project-filesystem',
            claimants: ['alpha'],
            status: 'added',
            takenOver: false,
          },
        ],
        prunedIntent: [],
      },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], result),
      }),
    )
    await settle()

    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('alpha MCP server filesystem')
    expect(frame).toContain('project-filesystem')
    expect(frame).toContain('alpha MCP server docs')
    expect(frame).toContain('omitted')
    instance.unmount()
  })

  // Drift repair and a fresh write are different facts about the user's
  // project, and one of them means someone else edited the config file.
  test('a drift-only rewrite reads as repaired, not written', async () => {
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 0, updated: 0, repaired: 1, unchanged: 0, removed: 0 },
        textAssets: { written: 0, removed: 0 },
        mcp: {
          configurations: { added: 0, updated: 0, repaired: 1, unchanged: 0, removed: 0 },
          declarations: { aliased: 0, omitted: 0 },
          takeovers: { accepted: 0 },
        },
      },
      perFacet: [{ kind: 'repaired', name: 'alpha', version: '1.0.0' }],
      mcp: {
        consent: { kind: 'not-required' },
        dispositions: [],
        configurations: [
          {
            kind: 'active',
            adapter: 'claude-code',
            effectiveName: 'filesystem',
            claimants: ['alpha'],
            status: 'repaired',
            takenOver: false,
          },
        ],
        prunedIntent: [],
      },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], result),
      }),
    )
    await settle()

    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('1 server config repaired')
    expect(frame).toContain('MCP server filesystem repaired in claude-code')
    instance.unmount()
  })

  test('a removed server names the adapters it was removed from', async () => {
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 0, updated: 0, repaired: 0, unchanged: 0, removed: 1 },
        textAssets: { written: 0, removed: 0 },
        mcp: {
          configurations: { added: 0, updated: 0, repaired: 0, unchanged: 0, removed: 1 },
          declarations: { aliased: 0, omitted: 0 },
          takeovers: { accepted: 0 },
        },
      },
      perFacet: [{ kind: 'removed', name: 'alpha', oldVersion: '1.0.0' }],
      mcp: {
        consent: { kind: 'not-required' },
        dispositions: [],
        configurations: [
          {
            kind: 'obsolete',
            adapter: 'claude-code',
            effectiveName: 'filesystem',
            previousClaimants: ['alpha'],
            status: 'removed',
          },
          {
            kind: 'obsolete',
            adapter: 'opencode',
            effectiveName: 'filesystem',
            previousClaimants: ['alpha'],
            status: 'removed',
          },
        ],
        prunedIntent: [],
      },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'remove',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], result),
      }),
    )
    await settle()

    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('MCP server filesystem removed in claude-code, opencode')
    instance.unmount()
  })

  // Adopting an untracked entry writes nothing and still changes who owns
  // it — the one case where "unchanged" and "nothing happened" differ.
  test('an adopted untracked entry is unchanged but not a no-op', async () => {
    const result: RunInstallResult = {
      ok: true,
      lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
      summary: {
        facets: { installed: 0, updated: 0, repaired: 0, unchanged: 1, removed: 0 },
        textAssets: { written: 0, removed: 0 },
        mcp: {
          configurations: { added: 0, updated: 0, repaired: 0, unchanged: 1, removed: 0 },
          declarations: { aliased: 0, omitted: 0 },
          takeovers: { accepted: 1 },
        },
      },
      perFacet: [{ kind: 'unchanged', name: 'alpha', version: '1.0.0' }],
      mcp: {
        consent: { kind: 'not-required' },
        dispositions: [],
        configurations: [
          {
            kind: 'active',
            adapter: 'claude-code',
            effectiveName: 'filesystem',
            claimants: ['alpha'],
            status: 'unchanged',
            takenOver: true,
          },
        ],
        prunedIntent: [],
      },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], result),
      }),
    )
    await settle()

    const frame = visibleContentFrame(instance.frames)
    expect(frame).not.toContain('no changes')
    expect(frame).toContain('1 server config unchanged')
    expect(frame).toContain('took over an existing entry')
    instance.unmount()
  })
})

// --- MCP consent and asset takeover phases ---

const CONSENT_REQUEST: McpConsentRequest = {
  declarations: [
    {
      identity: { kind: 'mcp-server', effectiveName: 'filesystem' },
      fingerprint: `sha256:${'a'.repeat(64)}`,
      declaration: { type: 'stdio', command: 'npx', args: ['-y', 'srv'], env: { TOKEN_NAME: 'hunter2' } },
      claimants: [{ facet: 'alpha', authoredName: 'filesystem', disposition: { kind: 'authored' } }],
      standing: { kind: 'unknown-identity' },
    },
  ],
  takeovers: [],
}

/**
 * A driver shaped like the engine's consent path: emit progress, block on
 * the resolver, then continue or fail based on the answer.
 */
function makeConsentingRun(onDecision: (decision: McpConsentDecision) => void) {
  return async ({ onStage, resolveMcpConsent }: InstallViewHooks): Promise<RunInstallResult> => {
    onStage({ kind: 'install-start', totalFacets: 1 })
    const decision = await resolveMcpConsent(CONSENT_REQUEST)
    onDecision(decision)
    if (decision.kind === 'declined') {
      return {
        ok: false,
        failure: { code: 'MCP_CONSENT_DECLINED', request: { declarations: [], takeovers: [] } },
        rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
      }
    }
    onStage({ kind: 'facet-start', facet: 'alpha', specifier: './alpha' })
    return successResultSingle
  }
}

describe('InstallView — MCP consent phase', () => {
  test('the approval screen replaces progress and returns to it once answered', async () => {
    const decisions: McpConsentDecision[] = []
    const instance = render(
      createElement(InstallView, { mode: 'install', run: makeConsentingRun((d) => decisions.push(d)) }),
    )
    await tick()

    const prompt = visibleTerminalText(instance.lastFrame() ?? '')
    expect(prompt).toContain('MCP server configuration needs your approval')
    expect(prompt).toContain('stdio "npx" "-y" "srv"')
    // The progress bar must not repaint underneath a screen the user is
    // reading; the prompt owns the mount while it is open.
    expect(prompt).not.toContain('Installing facets:')

    instance.stdin.write('\u001B[C')
    await tick()
    instance.stdin.write('\r')
    await tick()

    expect(decisions).toEqual([{ kind: 'approved' }])
    await settle()
    instance.unmount()
  })

  // Enter alone must not authorize execution: it is the key a user is
  // already pressing their way through an install with.
  test('confirming without navigating declines', async () => {
    const decisions: McpConsentDecision[] = []
    const instance = render(
      createElement(InstallView, { mode: 'install', run: makeConsentingRun((d) => decisions.push(d)) }),
    )
    await tick()
    instance.stdin.write('\r')
    await tick()

    expect(decisions).toEqual([{ kind: 'declined' }])
    await settle()
    expect(visibleContentFrame(instance.frames)).not.toContain('Install complete')
    instance.unmount()
  })

  // An unsettled promise strands the engine holding the project lock, so an
  // interrupt has to answer the prompt rather than kill the render.
  test('an interrupt while the screen is open settles it', async () => {
    const decisions: McpConsentDecision[] = []
    const controller = new AbortController()
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        signal: controller.signal,
        run: makeConsentingRun((d) => decisions.push(d)),
      }),
    )
    await tick()
    expect(decisions).toHaveLength(0)

    controller.abort()
    await tick()

    expect(decisions).toEqual([{ kind: 'declined' }])
    await settle()
    instance.unmount()
  })

  test('ctrl-c while the screen is open settles it', async () => {
    const decisions: McpConsentDecision[] = []
    const instance = render(
      createElement(InstallView, { mode: 'install', run: makeConsentingRun((d) => decisions.push(d)) }),
    )
    await tick()
    instance.stdin.write('\u0003')
    await tick()

    expect(decisions).toEqual([{ kind: 'declined' }])
    await settle()
    instance.unmount()
  })
})

describe('InstallView — asset takeover phase', () => {
  const TAKEOVER_REQUEST: AssetTakeoverRequest = {
    facet: 'alpha',
    adapter: 'claude-code',
    asset: assetIdentity('project', 'skill', 'review'),
    authoredName: 'review',
    occupancy: 'divergent',
  }

  function makeTakeoverRun(onDecision: (decision: AssetTakeoverDecision) => void) {
    return async ({ onStage, resolveAssetTakeover }: InstallViewHooks): Promise<RunInstallResult> => {
      onStage({ kind: 'install-start', totalFacets: 1 })
      const decision = await resolveAssetTakeover(TAKEOVER_REQUEST)
      onDecision(decision)
      if (decision.kind === 'cancelled') {
        return {
          ok: false,
          failure: {
            code: 'ASSET_TAKEOVER_CANCELLED',
            facet: 'alpha',
            adapter: 'claude-code',
            asset: assetIdentity('project', 'skill', 'review'),
          },
          rollback: { kind: 'complete', restored: ['/tmp/a', '/tmp/b'], alreadyRestored: [], removedDirectories: [] },
        }
      }
      return successResultSingle
    }
  }

  test('the screen names the destination and continues by default', async () => {
    const decisions: AssetTakeoverDecision[] = []
    const instance = render(
      createElement(InstallView, { mode: 'install', run: makeTakeoverRun((d) => decisions.push(d)) }),
    )
    await tick()
    expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('project skill review')

    instance.stdin.write('\r')
    await tick()
    expect(decisions).toEqual([{ kind: 'continue' }])
    await settle()
    instance.unmount()
  })

  // Cancelling here lands mid-journal, so the report has to say what the
  // rollback did rather than claim nothing happened.
  test('cancelling reports what was restored', async () => {
    const decisions: AssetTakeoverDecision[] = []
    const instance = render(
      createElement(InstallView, { mode: 'install', run: makeTakeoverRun((d) => decisions.push(d)) }),
    )
    await tick()
    instance.stdin.write('\u001B[C')
    await tick()
    instance.stdin.write('\r')
    await tick()

    expect(decisions).toEqual([{ kind: 'cancelled' }])
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('restored')
    expect(frame).not.toContain('nothing was written')
    instance.unmount()
  })

  // An interrupt is a request to stop. Answering it with the default would
  // let the operation write one more file on the way out.
  test('an interrupt cancels rather than continuing', async () => {
    const decisions: AssetTakeoverDecision[] = []
    const controller = new AbortController()
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        signal: controller.signal,
        run: makeTakeoverRun((d) => decisions.push(d)),
      }),
    )
    await tick()
    controller.abort()
    await tick()

    expect(decisions).toEqual([{ kind: 'cancelled' }])
    await settle()
    instance.unmount()
  })
})

describe('InstallView — declaration secrecy', () => {
  const SECRETS = ['npx', 'srv', 'hunter2', 'TOKEN_NAME']

  // The approval screen is one of only two surfaces allowed to show a
  // declaration. Everything the run prints afterwards is ordinary command
  // output that can end up in a scrollback or a CI log.
  test('a declaration does not survive into the success summary', async () => {
    const instance = render(createElement(InstallView, { mode: 'install', run: makeConsentingRun(() => {}) }))
    await tick()
    instance.stdin.write('\u001B[C')
    await tick()
    instance.stdin.write('\r')
    await settle()

    const frame = visibleContentFrame(instance.frames)
    for (const secret of SECRETS) expect(frame).not.toContain(secret)
    instance.unmount()
  })

  // Declining carries the SUMMARY, not the request: the user just read the
  // declarations and said no, so reprinting them helps nobody.
  test('declining does not reprint the declaration', async () => {
    const instance = render(createElement(InstallView, { mode: 'install', run: makeConsentingRun(() => {}) }))
    await tick()
    instance.stdin.write('\r')
    await settle()

    const frame = visibleContentFrame(instance.frames)
    for (const secret of SECRETS) expect(frame).not.toContain(secret)
    instance.unmount()
  })
})

// ---------------------------------------------------------------------------
// Update mode
// ---------------------------------------------------------------------------

/**
 * Update runs the same pipeline as everything else, so what is tested
 * here is only what a user reading the screen would otherwise get wrong:
 * which operation is running, and which version each facet ended up on.
 */
describe('InstallView — update mode', () => {
  const updateResult: RunInstallResult = {
    ok: true,
    lockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} },
    summary: {
      facets: { installed: 0, updated: 2, repaired: 0, unchanged: 1, removed: 0 },
      textAssets: { written: 4, removed: 0 },
      mcp: NO_MCP_COUNTS,
    },
    perFacet: [
      { kind: 'updated', name: 'alpha', oldVersion: '1.2.0', newVersion: '1.8.0' },
      { kind: 'updated', name: 'beta', oldVersion: '1.2.0', newVersion: '3.4.1' },
      { kind: 'unchanged', name: 'gamma', version: '4.0.0' },
    ],
    mcp: NO_MCP,
  }

  test('names the operation while it runs', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'update',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 2 }], updateResult),
      }),
    )
    // The header is only on screen before the result replaces it.
    await settle()
    expect(instance.frames.some((frame) => visibleTerminalText(frame ?? '').includes('Updating facets:'))).toBe(true)
    instance.unmount()
  })

  // "2 updated" says how many moved, not what anyone now has. The
  // transition per facet is the answer to the question the command was
  // run to ask.
  test('names every version transition it applied', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'update',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 2 }], updateResult),
      }),
    )
    await settle()
    const frame = visibleTerminalText(visibleContentFrame(instance.frames))
    expect(frame).toContain('Update complete.')
    expect(frame).toContain('alpha 1.2.0 → 1.8.0')
    expect(frame).toContain('beta 1.2.0 → 3.4.1')
    // A facet that was left alone is counted, not narrated as a move.
    expect(frame).not.toContain('gamma 4.0.0 →')
    instance.unmount()
  })

  test('the timer counts facets moved, not facets touched', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'update',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 2 }], updateResult),
      }),
    )
    await settle()
    expect(visibleTerminalText(visibleContentFrame(instance.frames))).toContain('Updated 2 facets')
    instance.unmount()
  })

  // `--verbose` is the only thing that turns these on, and where they land
  // is the whole point: a caller piping stdout to parse the summary must
  // not have diagnostics interleaved into it.
  test('verbose diagnostics go to stderr while progress stays on stdout', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'update',
        run: async ({ onStage, onLog }) => {
          onStage({ kind: 'install-start', totalFacets: 2 })
          onLog(() => 'resolved alpha@1.8.0 from cache')
          return updateResult
        },
      }),
    )
    await settle()

    expect(visibleTerminalText(instance.stderr.lastFrame() ?? '')).toContain('resolved alpha@1.8.0 from cache')

    const out = visibleTerminalText(visibleContentFrame(instance.frames))
    expect(out).toContain('alpha 1.2.0 → 1.8.0')
    expect(out).not.toContain('resolved alpha@1.8.0 from cache')
    instance.unmount()
  })

  test('a stale plan is reported as a failure, with the disk state', async () => {
    const stale: RunInstallResult = {
      ok: false,
      failure: { code: 'UPDATE_PLAN_STALE', files: ['manifest'] },
      rollback: NO_ROLLBACK,
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'update',
        run: makeFakeRun([], stale),
      }),
    )
    await settle()
    const frame = visibleTerminalText(visibleContentFrame(instance.frames))
    expect(frame).toContain('facets.json')
    expect(frame).toContain(visibleTerminalText(diskStateSentence(NO_ROLLBACK)))
    expect(frame).not.toContain('Update complete.')
    instance.unmount()
  })
})
