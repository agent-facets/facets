import { describe, expect, test } from 'bun:test'
import type {
  CollisionResolution,
  CollisionResolutionRequest,
  CollisionResolver,
  RunInstallFailure,
  RunInstallResult,
  StageEvent,
} from '@agent-facets/engine'
import { assetIdentity } from '@agent-facets/engine'
import type { FacetContribution, IntegrityFailure } from '@agent-facets/protocol'
import { planMaterialization } from '@agent-facets/protocol'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { InstallView } from '../tui/views/install/install-view.tsx'

/**
 * Wait long enough for the view's `useEffect` chain to finish (run the
 * fake driver, set state for events, set the result, render, schedule
 * the deferred exit).
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

/**
 * `ink-testing-library`'s `lastFrame()` returns the literal final frame,
 * which post-unmount is just `"\n"`. We want the last frame with actual
 * content — the one rendered immediately before the view auto-unmounted.
 *
 * Searches backwards from the end and returns the most recent frame
 * with non-trivial text. Throws if no such frame exists, so a missing
 * frame fails loudly instead of silently passing assertions.
 */
function findContentFrame(frames: ReadonlyArray<string | undefined>): string {
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]
    if (frame !== undefined && frame.trim().length > 0) return frame
  }
  throw new Error(`no content frame found among ${frames.length} captured frames`)
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

const successResultSingle: RunInstallResult = {
  ok: true,
  lockfile: { lockfileVersion: 1, facets: {} },
  summary: {
    installed: 1,
    updated: 0,
    repaired: 0,
    unchanged: 0,
    removed: 0,
    totalAssets: 3,
    removedAssets: 0,
  },
  perFacet: [{ kind: 'installed', name: 'viper-plans', version: '1.2.3' }],
  serverWarnings: [],
}

const successResultMulti: RunInstallResult = {
  ok: true,
  lockfile: { lockfileVersion: 1, facets: {} },
  summary: {
    installed: 2,
    updated: 1,
    repaired: 0,
    unchanged: 0,
    removed: 0,
    totalAssets: 9,
    removedAssets: 0,
  },
  perFacet: [
    { kind: 'installed', name: 'viper-plans', version: '1.2.3' },
    { kind: 'installed', name: 'rezi', version: '0.5.0' },
    { kind: 'updated', name: 'planner', oldVersion: '1.0.0', newVersion: '2.0.0' },
  ],
  serverWarnings: [],
}

const successResultNoOp: RunInstallResult = {
  ok: true,
  lockfile: { lockfileVersion: 1, facets: {} },
  summary: {
    installed: 0,
    updated: 0,
    repaired: 0,
    unchanged: 0,
    removed: 0,
    totalAssets: 0,
    removedAssets: 0,
  },
  perFacet: [],
  serverWarnings: [],
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
    const frame = findContentFrame(instance.frames)
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
    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('Install complete.')
    expect(frame).toContain('2 installed')
    expect(frame).toContain('1 updated')
    instance.unmount()
  })
})

describe('InstallView — server warnings', () => {
  test('renders a warning line when servers are declared', async () => {
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'facet-start', facet: 'with-servers', specifier: './fixture' },
      {
        kind: 'server-warning',
        facet: 'with-servers',
        servers: ['inline-server', 'remote-server'],
      },
      {
        kind: 'facet-success',
        facet: 'with-servers',
        outcome: { kind: 'installed', name: 'with-servers', version: '0.1.0' },
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
    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('with-servers')
    expect(frame).toContain('2 servers declared')
    expect(frame).toContain('inline-server')
    expect(frame).toContain('remote-server')
    // Ink wraps the warning message across lines in the test terminal width,
    // so we check for a substring that survives wrapping.
    expect(frame).toContain('not yet')
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
      lockfile: { lockfileVersion: 1, facets: {} },
      summary: {
        installed: 0,
        updated: 0,
        repaired: 0,
        unchanged: 0,
        removed: 1,
        totalAssets: 0,
        removedAssets: 2,
      },
      perFacet: [{ kind: 'removed', name: 'orphan', oldVersion: '1.0.0' }],
      serverWarnings: [],
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('1 removed')
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
        lockfileVersion: 1,
        facets: {
          cowsay: {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '0.1.0',
            integrity: 'sha256:x',
            assets: [
              { scope: 'project', type: 'command', name: 'cowsay' },
              { scope: 'project', type: 'skill', name: 'ascii-art' },
            ],
          },
        },
      },
      summary: {
        installed: 1,
        updated: 0,
        repaired: 0,
        unchanged: 0,
        removed: 0,
        totalAssets: 2,
        removedAssets: 0,
      },
      perFacet: [{ kind: 'installed', name: 'cowsay', version: '0.1.0' }],
      serverWarnings: [],
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = findContentFrame(instance.frames)
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
        lockfileVersion: 1,
        facets: {
          'pure-skills': {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '1.0.0',
            integrity: 'sha256:x',
            assets: [{ scope: 'project', type: 'skill', name: 'planning' }],
          },
        },
      },
      summary: {
        installed: 1,
        updated: 0,
        repaired: 0,
        unchanged: 0,
        removed: 0,
        totalAssets: 1,
        removedAssets: 0,
      },
      perFacet: [{ kind: 'installed', name: 'pure-skills', version: '1.0.0' }],
      serverWarnings: [],
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = findContentFrame(instance.frames)
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
        lockfileVersion: 1,
        facets: {
          // pre-existing — must NOT appear in the count
          'existing-skill': {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '1.0.0',
            integrity: 'sha256:y',
            assets: [
              { scope: 'project', type: 'skill', name: 'old-skill-a' },
              { scope: 'project', type: 'skill', name: 'old-skill-b' },
              { scope: 'project', type: 'command', name: 'old-command' },
            ],
          },
          // newly installed this run
          cowsay: {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '0.1.0',
            integrity: 'sha256:x',
            assets: [{ scope: 'project', type: 'command', name: 'cowsay' }],
          },
        },
      },
      summary: {
        installed: 1,
        updated: 0,
        repaired: 0,
        unchanged: 1,
        removed: 0,
        totalAssets: 1,
        removedAssets: 0,
      },
      perFacet: [
        { kind: 'installed', name: 'cowsay', version: '0.1.0' },
        // pre-existing — `unchanged` must NOT contribute to the bundle viz
        { kind: 'unchanged', name: 'existing-skill', version: '1.0.0' },
      ],
      serverWarnings: [],
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = findContentFrame(instance.frames)
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
        lockfileVersion: 1,
        facets: {
          cowsay: {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '0.1.0',
            integrity: 'sha256:x',
            assets: [{ scope: 'project', type: 'command', name: 'cowsay' }],
          },
        },
      },
      summary: {
        installed: 1,
        updated: 0,
        repaired: 0,
        unchanged: 0,
        removed: 0,
        totalAssets: 1,
        removedAssets: 0,
      },
      perFacet: [{ kind: 'installed', name: 'cowsay', version: '0.1.0' }],
      serverWarnings: [],
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = findContentFrame(instance.frames)
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
    const frame = findContentFrame(instance.frames)
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
    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('integrity check failed')
    expect(frame).toContain('check: B')
    expect(frame).toContain(integrityFailure.expected)
    expect(frame).toContain(integrityFailure.observed)
    expect(frame).toContain('No assets were written')
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
    const frame = findContentFrame(instance.frames)
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
    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('could not parse source for broken')
    expect(frame).toContain('git+ prefix is not supported')
    expect(frame).toContain('fix:')
    instance.unmount()
  })
})

describe('InstallView — aborted', () => {
  test('renders the aborted block with rollback note', async () => {
    const failure: RunInstallFailure = { code: 'ABORTED' }
    const events: StageEvent[] = [
      { kind: 'install-start', totalFacets: 1 },
      { kind: 'install-complete', outcome: 'aborted' },
    ]
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
    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('install aborted')
    expect(frame).toContain('Rolled back')
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
    const result: RunInstallResult = {
      ok: false,
      failure,
      rollback: { kind: 'partial-failure', entriesUndone: 0, failures: 2 },
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: makeFakeRun(events, result),
      }),
    )
    await settle()
    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('rollback completed with 2 partial failures')
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
    const frame = findContentFrame(instance.frames)
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
    const frame = findContentFrame(instance.frames)
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
    expect(instance.lastFrame() ?? '').toContain('Checking for name collisions')
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
    expect(instance.lastFrame() ?? '').toContain('Installation is paused')

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
    const frame = findContentFrame(instance.frames)
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
    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('Cancelled')
    expect(frame).toContain('Nothing was changed')
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
    expect(instance.lastFrame() ?? '').toContain('Installation is paused')

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
      lockfileVersion: 0.3,
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
    summary: { installed: 1, updated: 0, repaired: 0, unchanged: 0, removed: 0, totalAssets: 1, removedAssets: 0 },
    perFacet: [{ kind: 'installed', name: 'alpha', version: '1.0.0' }],
    serverWarnings: [],
  }

  test('shows the authored name beside the effective name, and marks omissions', async () => {
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], lockfileWithDispositions),
      }),
    )
    await settle()

    const frame = findContentFrame(instance.frames)
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
    const frame = findContentFrame(instance.frames)
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
            { kind: 'stale-override-pruned', facet: 'alpha', assetType: 'skill', authoredName: 'gone' },
          ],
          successResultSingle,
        ),
      }),
    )
    await settle()

    // No `onLog` was supplied — this has to be visible anyway, because
    // it silently changed what facets.json says.
    const frame = findContentFrame(instance.frames)
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
      lockfile: { lockfileVersion: 1, facets: {} },
      summary: { installed: 0, updated: 1, repaired: 0, unchanged: 0, removed: 0, totalAssets: 1, removedAssets: 0 },
      perFacet: [{ kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' }],
      serverWarnings: [],
    }
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: makeFakeRun([{ kind: 'install-start', totalFacets: 1 }], result),
      }),
    )
    await settle()

    const frame = findContentFrame(instance.frames)
    expect(frame).toContain('1 updated')
    expect(frame).not.toContain('repaired')
    expect(frame).not.toContain('1.0.0 → 1.0.0')
    instance.unmount()
  })
})
