import { describe, expect, test } from 'bun:test'
import type { McpServerCapabilityFailure } from '@agent-facets/adapter'
import type { RegistryError, RunInstallResult } from '@agent-facets/engine'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { visibleTerminalText } from '../../../../__tests__/helpers/terminal-output.ts'
import { FailureBlock } from '../failure-block.tsx'

/**
 * The rendered half of an MCP failure.
 *
 * The stderr `fix:` line and this block are two views of one condition, so the
 * assertions here mirror `install-failure.test.ts`: each conflict reason says
 * its own thing, and a declaration value cannot draw anything of its own.
 */

function frameFor(failure: McpServerCapabilityFailure, code: 'MCP_PREPARE_FAILED' | 'MCP_APPLY_FAILED'): string {
  const result = {
    ok: false,
    failure: { code, adapter: 'opencode', failure },
    rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
  } as Extract<RunInstallResult, { ok: false }>

  const instance = render(createElement(FailureBlock, { result }))
  const text = visibleTerminalText(instance.lastFrame() ?? '')
  instance.unmount()
  return text
}

function registryFrame(error: RegistryError, code: 'REGISTRY_ERROR' | 'CONFIRMATION_UNAVAILABLE'): string {
  const failure =
    code === 'REGISTRY_ERROR' ? { code, facet: 'example', error } : { code, facet: 'example', version: '1.2.3', error }
  const result = {
    ok: false,
    failure,
    rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
  } satisfies Extract<RunInstallResult, { ok: false }>
  const instance = render(createElement(FailureBlock, { result }))
  const text = visibleTerminalText(instance.lastFrame() ?? '')
  instance.unmount()
  return text
}

const INTERPOLATION: McpServerCapabilityFailure = {
  code: 'conflict',
  reason: 'interpolation',
  serverName: 'fs',
  value: '{env:TOKEN}',
}

describe('FailureBlock — MCP conflict reasons', () => {
  test('an interpolated literal shows the server, the value, and no document', () => {
    const text = frameFor(INTERPOLATION, 'MCP_PREPARE_FAILED')

    expect(text).toContain('opencode could not plan its MCP configuration')
    expect(text).toContain('"fs"')
    expect(text).toContain('"{env:TOKEN}"')
    expect(text).toContain('substitute')
    expect(text).not.toContain('opencode.jsonc')
  })

  test('a native-state conflict reports the adapter’s own detail once', () => {
    const text = frameFor(
      { code: 'conflict', reason: 'native-state', path: '/p/config.toml', detail: 'cannot patch an inline table' },
      'MCP_APPLY_FAILED',
    )

    expect(text).toContain('/p/config.toml')
    expect(text).toContain('cannot patch an inline table')
  })

  test('a hostile value cannot add a line or reach the terminal', () => {
    const clean = frameFor(INTERPOLATION, 'MCP_PREPARE_FAILED')
    const hostile = frameFor(
      { code: 'conflict', reason: 'interpolation', serverName: 'fs', value: '\u001b[2K\nforged heading' },
      'MCP_PREPARE_FAILED',
    )

    expect(hostile).not.toContain('\u001b[2K')
    expect(hostile.split('\n')).toHaveLength(clean.split('\n').length)
    expect(hostile).toContain('\\u001b[2K\\nforged heading')
  })
})

describe('FailureBlock — local authentication errors', () => {
  test('labels a local sign-in failure truthfully in the complete registry-error frame', () => {
    const text = registryFrame(
      { code: 'AUTHENTICATION_ERROR', reason: { code: 'REAUTHENTICATION_REQUIRED' } },
      'REGISTRY_ERROR',
    )
    expect(text).toBe(
      '✕ authentication problem while installing example registry sign-in has expired fix: sign in through your browser again Nothing was written; project state unchanged.',
    )
  })

  test('explains local sign-in failure truthfully in the complete confirmation frame', () => {
    const text = registryFrame(
      { code: 'AUTHENTICATION_ERROR', reason: { code: 'REAUTHENTICATION_REQUIRED' } },
      'CONFIRMATION_UNAVAILABLE',
    )
    expect(text).toBe(
      "✕ cannot create a lockfile entry for example@1.2.3 without registry confirmation The content is already cached — nothing needed downloading — but a new lockfile entry requires the registry's published integrity. Authentication could not complete, so confirmation cannot continue. registry sign-in has expired fix: sign in through your browser again Nothing was written; project state unchanged.",
    )
  })

  test('preserves the complete non-auth registry and confirmation frames', () => {
    const error: RegistryError = { code: 'NETWORK_ERROR', cause: 'connection refused', attempts: 1 }
    expect(registryFrame(error, 'REGISTRY_ERROR')).toBe(
      '✕ registry error for example network: connection refused Nothing was written; project state unchanged.',
    )
    expect(registryFrame(error, 'CONFIRMATION_UNAVAILABLE')).toBe(
      "✕ cannot create a lockfile entry for example@1.2.3 without registry confirmation The content is already cached — nothing needed downloading — but a new lockfile entry requires the registry's published integrity, and the registry could not be reached. network: connection refused Reconnect and retry. Reproducing an existing lockfile entry works offline. Nothing was written; project state unchanged.",
    )
  })

  test('shows actionable sign-in guidance in the visible registry-error frame', () => {
    const text = registryFrame(
      { code: 'AUTHENTICATION_ERROR', reason: { code: 'REAUTHENTICATION_REQUIRED' } },
      'REGISTRY_ERROR',
    )
    expect(text).toContain('registry sign-in has expired')
    expect(text).toContain('fix: sign in through your browser again')
    expect(text).not.toContain('UNEXPECTED_ERROR')
  })

  test('shows the same safe guidance for confirmation failure without printing nested path', () => {
    const secret = 'secret-canary-must-not-render'
    const text = registryFrame(
      { code: 'AUTHENTICATION_ERROR', reason: { code: 'PAT_UNREADABLE', path: `/tmp/${secret}` } },
      'CONFIRMATION_UNAVAILABLE',
    )
    expect(text).toContain('saved registry token cannot be read')
    expect(text).toContain('fix: check local credential file permissions')
    expect(text).not.toContain(secret)
    expect(text).not.toContain('Reconnect and retry')
  })

  test('does not render a hostile onboarding URL in the visible frame', () => {
    const secret = 'secret-canary-must-not-render'
    const text = registryFrame(
      { code: 'AUTHENTICATION_ERROR', reason: { code: 'ONBOARDING_REQUIRED', onboardingUrl: `javascript:${secret}` } },
      'REGISTRY_ERROR',
    )
    expect(text).toContain('open your registry onboarding page')
    expect(text).not.toContain(secret)
  })
})

describe('FailureBlock — server inventory reconciliation', () => {
  const FP_LOCKED = `sha256:${'1'.repeat(64)}` as const
  const FP_VERIFIED = `sha256:${'2'.repeat(64)}` as const

  function frame(failure: Extract<RunInstallResult, { ok: false }>['failure']): string {
    const result = {
      ok: false,
      failure,
      rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
    } satisfies Extract<RunInstallResult, { ok: false }>
    const instance = render(createElement(FailureBlock, { result }))
    const text = visibleTerminalText(instance.lastFrame() ?? '')
    instance.unmount()
    return text
  }

  test('a name-set mismatch names the facet and both directions', () => {
    const text = frame({ code: 'RECONCILE_SERVER_IDENTITY', facet: 'alpha', missing: ['gone'], unexpected: ['extra'] })
    expect(text).toContain('different MCP server set')
    expect(text).toContain('"alpha"')
    expect(text).toContain('locked but not declared: "gone"')
    expect(text).toContain('declared but not locked: "extra"')
  })

  test('a fingerprint mismatch names the server and both fingerprints', () => {
    const text = frame({
      code: 'RECONCILE_SERVER_FINGERPRINT',
      facet: 'alpha',
      authoredName: 'filesystem',
      expected: FP_LOCKED,
      actual: FP_VERIFIED,
    })
    expect(text).toContain('"filesystem"')
    expect(text).toContain(`locked: "${FP_LOCKED}"`)
    expect(text).toContain(`verified: "${FP_VERIFIED}"`)
  })

  test('guidance points at the lockfile, not at a retry or a deletion', () => {
    const text = frame({ code: 'RECONCILE_SERVER_IDENTITY', facet: 'alpha', missing: ['gone'], unexpected: [] })
    expect(text).toContain('trusted revision')
    expect(text).not.toContain('Delete facets.lock')
    expect(text).toContain('Nothing was written')
  })

  test('a hostile name cannot add a line or reach the terminal', () => {
    const clean = frame({ code: 'RECONCILE_SERVER_IDENTITY', facet: 'alpha', missing: ['gone'], unexpected: [] })
    const hostile = frame({
      code: 'RECONCILE_SERVER_IDENTITY',
      facet: 'alpha\u001b[2K\nforged',
      missing: ['gone\nforged line'],
      unexpected: [],
    })
    expect(hostile).not.toContain('\u001b[2K')
    expect(hostile).toContain('\\u001b[2K\\nforged')
    expect(hostile).toContain('"gone\\nforged line"')
    expect(hostile.split('\n')).toHaveLength(clean.split('\n').length)
  })
})

describe('FailureBlock — frozen checks over locked metadata', () => {
  const FP_A = `sha256:${'a'.repeat(64)}` as const
  const FP_B = `sha256:${'b'.repeat(64)}` as const

  function frame(result: Extract<RunInstallResult, { ok: false }>): string {
    const instance = render(createElement(FailureBlock, { result }))
    const text = visibleTerminalText(instance.lastFrame() ?? '')
    instance.unmount()
    return text
  }

  const unchanged = { kind: 'not-needed', reason: 'post-lock-no-mutation' } as const

  test('a locked server collision names every claimant by its recorded fingerprint', () => {
    const text = frame({
      ok: false,
      rollback: unchanged,
      failure: {
        code: 'LOCKED_MATERIALIZATION_COLLISION',
        staleOverrides: [],
        groups: [
          {
            kind: 'mcp-server',
            group: {
              effectiveName: 'filesystem',
              members: [
                {
                  facet: 'alpha',
                  authoredName: 'filesystem',
                  effectiveName: 'filesystem',
                  fingerprint: FP_A,
                  disposition: { kind: 'authored' },
                },
                {
                  facet: 'beta',
                  authoredName: 'fs',
                  effectiveName: 'filesystem',
                  fingerprint: FP_B,
                  disposition: { kind: 'aliased', as: 'filesystem' },
                },
              ],
            },
          },
        ],
      },
    })

    expect(text).toContain('“filesystem” is claimed by')
    expect(text).toContain('alpha (server filesystem)')
    expect(text).toContain('beta (server fs)')
    expect(text).toContain(`locked fingerprint ${FP_A}`)
    expect(text).toContain(`locked fingerprint ${FP_B}`)
    expect(text).toContain('Nothing was fetched')
    expect(text).toContain('without --frozen-lockfile')
  })

  test('server disposition drift reads as manifest versus lockfile', () => {
    const text = frame({
      ok: false,
      rollback: unchanged,
      failure: {
        code: 'LOCKFILE_DRIFT',
        facets: [
          {
            name: 'alpha',
            reason: 'server-materialization-drift',
            authoredName: 'filesystem',
            manifest: { kind: 'authored' },
            locked: { kind: 'aliased', as: 'fs' },
          },
        ],
      },
    })

    expect(text).toContain('alpha: server "filesystem": facets.json says authored, lockfile says aliased to "fs"')
  })

  test('a removal migration is explained beside the failure, never instead of it', () => {
    const text = frame({
      ok: false,
      rollback: unchanged,
      failure: {
        code: 'REGISTRY_ERROR',
        facet: 'planner',
        error: { code: 'NETWORK_ERROR', cause: 'offline', attempts: 1 },
      },
      removalMigration: {
        reason: 'remaining-server-inventory-unavailable',
        lockfileVersion: 0.3,
        requiredVersion: 0.4,
      },
    })

    expect(text).toContain('facets.lock v0.3 records no MCP server inventory')
    expect(text).toContain('to write v0.4')
    // The actual cause is still the headline it always was.
    expect(text).toContain('registry error for planner')
    expect(text.indexOf('v0.3 records')).toBeLessThan(text.indexOf('registry error'))
  })
})
