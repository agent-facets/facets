import { describe, expect, test } from 'bun:test'
import type {
  CollisionResolution,
  CollisionResolutionRequest,
  CollisionResolver,
  InstallSummary,
  McpInstallOutcomes,
  RollbackOutcome,
  RunInstallFailure,
  RunInstallResult,
  StageEvent,
} from '@agent-facets/engine'
import { assetIdentity } from '@agent-facets/engine'
import type { FacetContribution, IntegrityFailure } from '@agent-facets/protocol'
import { CURRENT_LOCKFILE_VERSION, LOCKFILE_VERSION_0_3, planMaterialization } from '@agent-facets/protocol'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { InstallView, type InstallViewResult } from '../tui/views/install/install-view.tsx'
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
 * Build a fake `run` driver that emits a canned event sequence and
 * resolves to a canned result. Lets each test exercise a specific
 * render path of `<InstallView />` without spinning up `runInstall`.
 */
function makeFakeRun(
  events: ReadonlyArray<StageEvent>,
  result: RunInstallResult,
): (onStage: (e: StageEvent) => void, onLog?: (build: () => string) => void) => Promise<RunInstallResult> {
  return async (onStage, _onLog) => {
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
            { kind: 'receipt-unpersisted', cause: 'EACCES' },
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

  test('warns when a bundle was left behind because its primary was missing', async () => {
    // The summary says the facet was removed; these files are still there.
    const instance = render(
      createElement(InstallView, {
        mode: 'remove',
        run: makeFakeRun(
          [
            { kind: 'install-start', totalFacets: 0 },
            {
              kind: 'obsolete-bundle-retained',
              adapter: 'claude-code',
              scope: 'project',
              assetName: 'review',
              facets: ['alpha'],
              companionPaths: ['refs/api.md'],
            },
            { kind: 'install-complete', outcome: 'success' },
          ],
          emptySuccess(),
        ),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('review')
    expect(frame).toContain('refs/api.md')
    expect(frame).toContain('no longer tracked')
    instance.unmount()
  })

  test('names the scope of each retained bundle so same-named ones stay distinguishable', async () => {
    // One adapter resolves a different directory per scope, so these are two
    // separate piles of files to clean up. Without the scope the two warnings
    // are the same sentence twice, pointing at an unspecified skill root.
    const instance = render(
      createElement(InstallView, {
        mode: 'remove',
        run: makeFakeRun(
          [
            { kind: 'install-start', totalFacets: 0 },
            {
              kind: 'obsolete-bundle-retained',
              adapter: 'claude-code',
              scope: 'project',
              assetName: 'review',
              facets: ['alpha'],
              companionPaths: ['refs/project.md'],
            },
            {
              kind: 'obsolete-bundle-retained',
              adapter: 'claude-code',
              scope: 'user',
              assetName: 'review',
              facets: ['alpha'],
              companionPaths: ['refs/user.md'],
            },
            { kind: 'install-complete', outcome: 'success' },
          ],
          emptySuccess(),
        ),
      }),
    )
    await settle()
    const frame = visibleContentFrame(instance.frames)
    expect(frame).toContain('project scope')
    expect(frame).toContain('user scope')
    // Both rows rendered — a scope-free React key would have collapsed them.
    expect(frame).toContain('refs/project.md')
    expect(frame).toContain('refs/user.md')
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
      rollback: { kind: 'not-needed', reason: 'test fixture' },
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
    expect(frame).toContain(diskStateSentence({ kind: 'not-needed', reason: 'test fixture' }))
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
      rollback: { kind: 'not-needed', reason: 'test fixture' },
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
      rollback: { kind: 'not-needed', reason: 'test fixture' },
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
    { kind: 'not-needed', reason: 'test fixture' },
    { kind: 'succeeded', entriesUndone: 3 },
    { kind: 'partial-failure', entriesUndone: 0, failures: 2 },
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
      rollback: { kind: 'not-needed', reason: 'test fixture' },
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
    const rollback: RollbackOutcome = { kind: 'partial-failure', entriesUndone: 0, failures: 2 }
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
    expect(frame).toContain('Some adapter writes could not be undone')
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
      rollback: { kind: 'not-needed', reason: 'test fixture' },
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
})

// ---------------------------------------------------------------------------
// Collision resolution: the workspace phase inside the same Ink mount
// ---------------------------------------------------------------------------

const KEY = { down: '\u001B[B', right: '\u001B[C', enter: '\r', escape: '\u001B' } as const

function collisionRequest(): CollisionResolutionRequest {
  // Planner contributions are AUTHORED assets — identity only. They carry no
  // disposition or file records, unlike a lockfile entry.
  const contributions: FacetContribution[] = [
    { facet: 'alpha', assets: [{ scope: 'project', type: 'skill', name: 'review' }] },
    { facet: 'beta', assets: [{ scope: 'project', type: 'skill', name: 'review' }] },
  ]
  const planned = planMaterialization(contributions)
  if (planned.ok || planned.reason !== 'collision') expect.unreachable()
  return { groups: planned.groups, contributions, staleOverrides: [] }
}

const CANCELLED_RESULT: RunInstallResult = {
  ok: false,
  failure: { code: 'MATERIALIZATION_CANCELLED' },
  rollback: { kind: 'not-needed', reason: 'no journal was created' },
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
  return async (
    onStage: (e: StageEvent) => void,
    _onLog: ((build: () => string) => void) | undefined,
    resolveCollisions: CollisionResolver,
  ): Promise<RunInstallResult> => {
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
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: async (onStage) => {
          onStage({ kind: 'install-start', totalFacets: 2 })
          onStage({ kind: 'collision-check' })
          await tick()
          return successResultSingle
        },
      }),
    )
    await tick()
    expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('Checking for name collisions')
    await settle()
    instance.unmount()
  })

  // Collision checking is evaluated once over the COMPLETE desired set, not
  // per facet. A rendering that showed it for one facet and skipped it for
  // several would misdescribe when the check happens — and the spec's
  // single-facet scenario named it while the multi-facet one did not.
  test('the same single global phase is shown for a multi-facet run', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: async (onStage) => {
          onStage({ kind: 'install-start', totalFacets: 2 })
          for (const facet of ['alpha', 'beta']) {
            onStage({ kind: 'facet-start', facet, specifier: `./${facet}` })
            onStage({ kind: 'facet-stage', facet, stage: 'verify' })
          }
          onStage({ kind: 'collision-check' })
          await tick()
          return successResultSingle
        },
      }),
    )
    await tick()

    const paused = visibleTerminalText(instance.lastFrame() ?? '')
    expect(paused).toContain('Checking for name collisions across all facets')
    // One phase, not one per facet.
    expect(paused.match(/Checking for name collisions/g)).toHaveLength(1)

    await settle()
    instance.unmount()
  })

  test('the collision phase clears once materialization starts', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: async (onStage) => {
          onStage({ kind: 'install-start', totalFacets: 2 })
          onStage({ kind: 'facet-start', facet: 'alpha', specifier: './alpha' })
          onStage({ kind: 'collision-check' })
          await tick()
          onStage({ kind: 'facet-stage', facet: 'alpha', stage: 'materialize' })
          await tick()
          return successResultSingle
        },
      }),
    )
    await tick()
    expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('Checking for name collisions')

    await tick()
    await tick()
    expect(visibleTerminalText(instance.lastFrame() ?? '')).not.toContain('Checking for name collisions')

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
    expect(frame).toContain(diskStateSentence({ kind: 'not-needed', reason: 'test fixture' }))
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
