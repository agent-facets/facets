import { describe, expect, test } from 'bun:test'
import { ADAPTER_API_VERSION, type Adapter } from '@agent-facets/adapter'
import { captureProjectPlanningContext } from '../planning-context.ts'

function adapter(assets: readonly string[] | false, mcpServers: readonly string[] | false): Adapter {
  const capability = (locationEnvironment: readonly string[]) => ({
    supportedScopes: ['project'] as const,
    locationEnvironment,
  })
  return {
    name: 'declares',
    apiVersion: ADAPTER_API_VERSION,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    assets:
      assets === false
        ? false
        : {
            ...capability(assets),
            planInstall: async () => expect.unreachable(),
            planRemoval: async () => expect.unreachable(),
          },
    mcpServers: mcpServers === false ? false : { ...capability(mcpServers), plan: async () => expect.unreachable() },
  }
}

describe('captureProjectPlanningContext', () => {
  test('targets the project with the supplied home', () => {
    const context = captureProjectPlanningContext('/work/app', [], { environment: {}, home: '/home/alice' })
    expect(context).toEqual({
      target: { scope: 'project', projectRoot: '/work/app' },
      homeDirectory: '/home/alice',
      environment: {},
    })
  })

  test('captures only the union of declared variables, never an undeclared one', () => {
    const context = captureProjectPlanningContext(
      '/work/app',
      [adapter(['XDG_CONFIG_HOME'], ['CODEX_HOME']), adapter(false, ['CODEX_HOME'])],
      {
        environment: { XDG_CONFIG_HOME: '/x', CODEX_HOME: '/c', AWS_SECRET_ACCESS_KEY: 'secret' },
        home: '/home/alice',
      },
    )
    expect(context.environment).toEqual({ XDG_CONFIG_HOME: '/x', CODEX_HOME: '/c' })
  })

  test('a declared but unset variable is absent rather than undefined-valued', () => {
    const context = captureProjectPlanningContext('/work/app', [adapter(['CLAUDE_CONFIG_DIR'], false)], {
      environment: {},
      home: '/h',
    })
    expect(Object.hasOwn(context.environment, 'CLAUDE_CONFIG_DIR')).toBe(false)
  })

  test('is captured once: a later ambient change does not reach the captured context', () => {
    const environment: Record<string, string> = { XDG_CONFIG_HOME: '/before' }
    const context = captureProjectPlanningContext('/work/app', [adapter(['XDG_CONFIG_HOME'], false)], {
      environment,
      home: '/h',
    })
    environment.XDG_CONFIG_HOME = '/after'
    expect(context.environment.XDG_CONFIG_HOME).toBe('/before')
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.target)).toBe(true)
    expect(Object.isFrozen(context.environment)).toBe(true)
  })
})
