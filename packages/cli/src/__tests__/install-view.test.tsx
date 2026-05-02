import { describe, expect, test } from 'bun:test'
import type { IntegrityFailure, RunInstallFailure, RunInstallResult, StageEvent } from '@agent-facets/core'
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
): (onStage: (e: StageEvent) => void) => Promise<RunInstallResult> {
  return async (onStage) => {
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
    expect(frame).toContain('Adding facets...')
    expect(frame).toContain('viper-plans@1.2.3')
    expect(frame).toContain('Done.')
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
    expect(frame).toContain('Installing facets...')
    expect(frame).toContain('viper-plans@1.2.3')
    expect(frame).toContain('rezi@0.5.0')
    expect(frame).toContain('planner@2.0.0')
    expect(frame).toContain('was 1.0.0')
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
    expect(frame).toContain('removed orphan@1.0.0')
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
            source: 'cowsay@latest',
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
    expect(frame).toContain('+ 1 skill · 1 command')
    expect(frame).toContain('Now /cowsay is available to your agents.')
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
            source: 'pure-skills@1.0.0',
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
    expect(frame).toContain('+ 1 skill')
    expect(frame).not.toContain('is available to your agents')
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
            source: 'cowsay@latest',
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
    expect(frame).toContain('+ 1 command')
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
    expect(frame).toContain('Nothing to install')
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
      rollback: { ok: true },
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
      rollback: { ok: true },
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
      rollback: { ok: true },
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
      adapter: 'unknown',
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
      rollback: { ok: false, partialFailures: 2 },
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
