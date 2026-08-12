import { describe, expect, test } from 'bun:test'
import { assetIdentity, type RollbackOutcome, type RunInstallFailure } from '@agent-facets/engine'
import { describeDiskState } from '../../../util/install-outcome.ts'
import { ACCEPT_MCP_FLAG } from '../flags.ts'
import { installFailureDetail, installFailureFix } from '../install-failure.ts'

/**
 * The `fix:` line for a failed install-pipeline run.
 *
 * Two things are easy to get wrong here and were: describing an abort as
 * "nothing was written" when a rollback actually ran, and dropping the
 * originating command from a branch that could name it.
 */

const COMMANDS: Array<'add' | 'install' | 'remove'> = ['add', 'install', 'remove']

const notNeeded: RollbackOutcome = { kind: 'not-needed', reason: 'no journal was created' }
const succeeded: RollbackOutcome = { kind: 'succeeded', entriesUndone: 3 }
const partial: RollbackOutcome = { kind: 'partial-failure', entriesUndone: 2, failures: 1 }

const aborted: RunInstallFailure = { code: 'ABORTED' }
const cancelled: RunInstallFailure = { code: 'MATERIALIZATION_CANCELLED' }
// Nothing in this arm is special-cased, which is the point: it stands in for
// every code that falls through to the default branch.
const lockHeld: RunInstallFailure = { code: 'LOCK_HELD', path: '/p/.facet.lock', heldByPid: 42 }

describe('installFailureFix — an aborted run', () => {
  test('says nothing was written only when no rollback was needed', () => {
    const fix = installFailureFix(aborted, notNeeded, 'install')
    expect(fix).toContain('nothing was written')
    expect(fix).not.toContain('restored')
  })

  // ABORTED can land after the journal opened — mid-apply, or after obsolete
  // assets were deleted. Those writes are undone, not absent.
  test('says the project was restored when a rollback ran', () => {
    const fix = installFailureFix(aborted, succeeded, 'install')
    expect(fix).toContain('restored')
    expect(fix).not.toContain('nothing was written')
  })

  test('partial rollback still outranks everything', () => {
    const fix = installFailureFix(aborted, partial, 'install')
    expect(fix).toContain('partial state may remain')
  })

  test.each(COMMANDS)('names the %s command on both rollback outcomes', (command) => {
    expect(installFailureFix(aborted, notNeeded, command)).toContain(`facet ${command}`)
    expect(installFailureFix(aborted, succeeded, command)).toContain(`facet ${command}`)
  })

  // The `fix:` line and the Ink block are two renderings of one fact. This
  // pins the stderr half to the shared helper; `install-view.test.tsx` pins
  // the rendered half to the same one.
  test.each([notNeeded, succeeded, partial])('$kind is described by the shared helper', (rollback) => {
    expect(installFailureFix(aborted, rollback, 'install')).toContain(describeDiskState(rollback))
  })
})

describe('installFailureFix — every code derives its disk state', () => {
  // The bug this prevents: an arm that hardcodes what happened on disk.
  // `MATERIALIZATION_CANCELLED` said "nothing was written" and the default
  // arm said "rollback complete", both regardless of the rollback outcome —
  // so stderr could claim a rollback had run while the Ink block rendered
  // from the SAME result said the project was never touched.
  const codes: RunInstallFailure[] = [aborted, cancelled, lockHeld]

  for (const failure of codes) {
    test.each([notNeeded, succeeded, partial])(`${failure.code} + $kind uses the shared helper`, (rollback) => {
      expect(installFailureFix(failure, rollback, 'install')).toContain(describeDiskState(rollback))
    })
  }

  test('a no-write failure never claims a rollback ran', () => {
    for (const failure of codes) {
      const fix = installFailureFix(failure, notNeeded, 'install')
      expect(fix).toContain('nothing was written')
      expect(fix).not.toContain('rollback complete')
      expect(fix).not.toContain('restored')
    }
  })

  test('a rolled-back failure never claims nothing was written', () => {
    for (const failure of codes) {
      const fix = installFailureFix(failure, succeeded, 'install')
      expect(fix).toContain('restored')
      expect(fix).not.toContain('nothing was written')
    }
  })
})

describe('installFailureDetail', () => {
  // Scripts branch on the code, so it stays first and stays machine-shaped.
  test('leads with the failure code', () => {
    expect(installFailureDetail(aborted)).toBe('code=ABORTED')
  })

  // The pipeline's front doors printed only the code for this one, so the
  // two numbers that ARE the report reached stderr on the prepare paths and
  // nowhere else.
  test('an unsupported manifest version carries its path and versions', () => {
    const detail = installFailureDetail({
      code: 'FACETS_JSON_UNSUPPORTED_VERSION',
      path: '/p/facets.json',
      observed: 0.9,
      supported: [0.1],
    })
    expect(detail).toContain('code=FACETS_JSON_UNSUPPORTED_VERSION')
    expect(detail).toContain('/p/facets.json')
    expect(detail).toContain('0.9')
    expect(detail).toContain('0.1')
  })

  test('a non-numeric version is described rather than invented', () => {
    const detail = installFailureDetail({
      code: 'FACETS_JSON_UNSUPPORTED_VERSION',
      path: '/p/facets.json',
      observed: undefined,
      supported: [0.1],
    })
    expect(detail).toContain('non-numeric')
  })
})

describe('installFailureFix — actionable failures name their command', () => {
  const actionable: RunInstallFailure[] = [
    {
      code: 'MATERIALIZATION_ALIAS_INVALID',
      problems: [
        {
          kind: 'asset',
          facet: 'a',
          assetType: 'skill',
          authoredName: 'review',
          alias: 'Bad',
          reason: 'must be lowercase',
        },
      ],
    },
    { code: 'MATERIALIZATION_COLLISION', groups: [], staleOverrides: [] },
    { code: 'MATERIALIZATION_CANCELLED' },
  ]

  test.each(COMMANDS)('every actionable failure tells a %s user what to re-run', (command) => {
    for (const failure of actionable) {
      expect(installFailureFix(failure, notNeeded, command)).toContain(`facet ${command}`)
    }
  })
})

describe('installFailureFix — an unsupported manifest version', () => {
  // The file is not wrong; this CLI is behind it. The generic
  // "fix the underlying issue" arm sent users editing a valid manifest.
  test('says to upgrade rather than to fix the manifest', () => {
    const fix = installFailureFix(
      { code: 'FACETS_JSON_UNSUPPORTED_VERSION', path: '/p/facets.json', observed: 0.9, supported: [0.1] },
      notNeeded,
      'install',
    )
    expect(fix).toContain('upgrade')
    expect(fix).not.toContain('fix the underlying issue')
  })
})

describe('installFailureFix — MCP failures', () => {
  const consentRequired: RunInstallFailure = {
    code: 'MCP_CONSENT_REQUIRED',
    request: { declarations: [], takeovers: [] },
  }
  const consentDeclined: RunInstallFailure = {
    code: 'MCP_CONSENT_DECLINED',
    request: { declarations: [], takeovers: [] },
  }
  const unsupported: RunInstallFailure = {
    code: 'MCP_ADAPTERS_UNSUPPORTED',
    adapters: [{ kind: 'capability-declined', adapter: 'plain-tool' }],
    servers: ['docs'],
  }

  // The flag name is owned by the shared definition. A literal here and a
  // literal there is how the guidance ends up naming a flag that no command
  // declares — which is exactly the state this line was in before.
  test.each(COMMANDS)('consent guidance names the %s command and the flag', (command) => {
    const fix = installFailureFix(consentRequired, notNeeded, command)
    expect(fix).toContain(`facet ${command} --${ACCEPT_MCP_FLAG}`)
  })

  // Two remedies, and only one of them is "upgrade". An adapter that
  // declared no MCP support will not gain it in a newer release.
  test('an unsupported adapter is offered both remedies', () => {
    const fix = installFailureFix(unsupported, notNeeded, 'install')
    expect(fix).toContain('upgrade')
    expect(fix).toContain('omit')
  })

  test('declining derives its disk state from the rollback outcome', () => {
    expect(installFailureFix(consentDeclined, notNeeded, 'install')).toContain(describeDiskState(notNeeded))
  })

  // This one lands mid-application, so what is on disk is the load-bearing
  // half of the report and must never be hardcoded.
  test.each([notNeeded, succeeded, partial])('a cancelled takeover reports $kind', (rollback) => {
    const failure: RunInstallFailure = {
      code: 'ASSET_TAKEOVER_CANCELLED',
      facet: 'alpha',
      adapter: 'claude-code',
      asset: assetIdentity('project', 'skill', 'review'),
    }
    expect(installFailureFix(failure, rollback, 'install')).toContain(describeDiskState(rollback))
  })
})

describe('installFailureFix — stale materialization intent under frozen mode', () => {
  const staleServerDrift: RunInstallFailure = {
    code: 'LOCKFILE_DRIFT',
    facets: [
      {
        name: 'alpha',
        reason: 'stale-override',
        contribution: { kind: 'mcp-server' },
        authoredName: 'filesystem',
      },
    ],
  }

  // The lockfile does not record server intent at all, so "run install to
  // update the lockfile" sends the user to watch the same failure again.
  // The choice lives in facets.json.
  test('points at facets.json rather than at the lockfile', () => {
    const fix = installFailureFix(staleServerDrift, notNeeded, 'install')
    expect(fix).toContain('facets.json')
    expect(fix).not.toContain('lockfile is out of date')
  })

  test('ordinary drift still points at the lockfile', () => {
    const fix = installFailureFix(
      { code: 'LOCKFILE_DRIFT', facets: [{ name: 'alpha', reason: 'missing-lockfile', manifestSpec: '1.*' }] },
      notNeeded,
      'install',
    )
    expect(fix).toContain('lockfile is out of date')
  })
})
