import { describe, expect, test } from 'bun:test'
import type { McpServerDeclaration as ProtocolMcpServerDeclaration } from '@agent-facets/protocol/mcp-declaration'
import { ADAPTER_API_VERSION, ADAPTER_API_VERSION_PACKAGE_FIELD } from '../api-version.ts'
import { defineAdapter } from '../define-adapter.ts'
import type {
  McpServerCapability,
  McpServerContribution,
  McpServerDeclaration,
  PlanMcpServersRequest,
} from '../mcp-servers.ts'
import type { PlanningContext } from '../planning-context.ts'
import type {
  Adapter,
  AdapterDefinition,
  AssetCapability,
  PlanAssetInstallRequest,
  PlanAssetInstallResult,
} from '../types.ts'

/**
 * A minimal valid capability set for tests that need a base object.
 * Overrides any individual field by spreading this then assigning.
 */
function assetCapability(overrides: Partial<AssetCapability> = {}): AssetCapability {
  return {
    supportedScopes: ['project', 'user'],
    locationEnvironment: [],
    async planInstall() {
      return {
        ok: true,
        plan: {
          occupancy: 'equivalent',
          action: { kind: 'unchanged' },
          primaryPath: '/tmp/test/x.md',
          storageRoot: '/tmp/test',
        },
      }
    },
    async planRemoval() {
      return { ok: true, plan: { kind: 'absent', primaryPath: '/tmp/test/x.md', storageRoot: '/tmp/test' } }
    },
    ...overrides,
  }
}

function mcpCapability(overrides: Partial<McpServerCapability> = {}): McpServerCapability {
  return {
    supportedScopes: ['project', 'user'],
    locationEnvironment: [],
    async plan() {
      return { ok: true, plan: { outcomes: [], documentPaths: ['/tmp/test/a.json'], action: { kind: 'unchanged' } } }
    },
    ...overrides,
  }
}

function validDefinition(): AdapterDefinition {
  return {
    name: 'test-adapter',
    assets: assetCapability(),
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
  }
}

/** The adapter from a definition that must be valid. */
function defined(definition: AdapterDefinition): Adapter {
  const result = defineAdapter(definition)
  if (!result.ok) expect.unreachable()
  return result.data
}

/** The error paths a definition that must be invalid produces, without throwing. */
function rejectedPaths(definition: unknown): string[] {
  // biome-ignore lint/suspicious/noExplicitAny: simulating untyped JavaScript input
  const result = defineAdapter(definition as any)
  if (result.ok) expect.unreachable()
  for (const error of result.errors) {
    expect(typeof error.message).toBe('string')
    expect(typeof error.expected).toBe('string')
    expect(typeof error.actual).toBe('string')
  }
  return result.errors.map((error) => error.path)
}

describe('defineAdapter — invalid definitions are returned as data', () => {
  test('a missing name is reported at "name"', () => {
    expect(rejectedPaths({ ...validDefinition(), name: undefined })).toEqual(['name'])
  })

  test('an empty name is reported at "name"', () => {
    expect(rejectedPaths({ ...validDefinition(), name: '' })).toEqual(['name'])
  })

  test('a non-string name is reported at "name"', () => {
    expect(rejectedPaths({ ...validDefinition(), name: 42 })).toEqual(['name'])
  })

  test('a missing or non-function buildAssetMetadata is reported at its own path', () => {
    expect(rejectedPaths({ ...validDefinition(), buildAssetMetadata: undefined })).toEqual(['buildAssetMetadata'])
    expect(rejectedPaths({ ...validDefinition(), buildAssetMetadata: 'not-a-function' })).toEqual([
      'buildAssetMetadata',
    ])
  })

  test('a missing assets capability is reported', () => {
    const { assets: _omitted, ...definition } = validDefinition()
    expect(rejectedPaths(definition)).toEqual(['assets'])
  })

  test('assets declared as true rather than a capability is reported', () => {
    expect(rejectedPaths({ ...validDefinition(), assets: true })).toEqual(['assets'])
  })

  test('an asset capability that can plan an install but not a removal is reported at the missing operation', () => {
    // An adapter that could put files on disk and never take them off would be
    // discovered at `facet remove`, long after the files exist.
    const { planRemoval: _omitted, ...partial } = assetCapability()
    expect(rejectedPaths({ ...validDefinition(), assets: partial })).toEqual(['assets.planRemoval'])
  })

  test('a missing mcpServers capability is reported', () => {
    const { mcpServers: _omitted, ...definition } = validDefinition()
    expect(rejectedPaths(definition)).toEqual(['mcpServers'])
  })

  test('mcpServers declared as true rather than a capability is reported', () => {
    expect(rejectedPaths({ ...validDefinition(), mcpServers: true })).toEqual(['mcpServers'])
  })

  test('every problem is reported together, not only the first', () => {
    expect(rejectedPaths({ name: '', assets: true, mcpServers: { plan: 1 } }).sort()).toEqual([
      'assets',
      'buildAssetMetadata',
      'mcpServers.locationEnvironment',
      'mcpServers.plan',
      'mcpServers.supportedScopes',
      'name',
    ])
  })

  test.each([
    ['null', null],
    ['an array', []],
    ['a string', 'adapter'],
    ['a number', 7],
    ['undefined', undefined],
  ])('a definition that is %s is rejected at the root without throwing', (_label, definition) => {
    expect(rejectedPaths(definition)).toEqual([''])
  })

  test('a definition whose getter throws is rejected, not propagated', () => {
    const definition = {
      ...validDefinition(),
      get name(): string {
        throw new Error('getter exploded')
      },
    }
    expect(rejectedPaths(definition)).toEqual(['name'])
  })
})

describe('defineAdapter — capability declarations', () => {
  test('a capability with both scopes reports both', () => {
    const adapter = defined(validDefinition())
    if (adapter.assets === false) expect.unreachable()
    expect(adapter.assets.supportedScopes).toEqual(['project', 'user'])
  })

  test('a project-only capability is a valid definition', () => {
    const adapter = defined({ ...validDefinition(), mcpServers: mcpCapability({ supportedScopes: ['project'] }) })
    if (adapter.mcpServers === false) expect.unreachable()
    expect(adapter.mcpServers.supportedScopes).toEqual(['project'])
  })

  test('an empty location declaration is valid', () => {
    const adapter = defined({ ...validDefinition(), assets: assetCapability({ locationEnvironment: [] }) })
    if (adapter.assets === false) expect.unreachable()
    expect(adapter.assets.locationEnvironment).toEqual([])
  })

  test('an empty supported-scope set is rejected, naming the capability', () => {
    // biome-ignore lint/suspicious/noExplicitAny: an empty tuple is unrepresentable in the type, as intended
    const mcpServers = mcpCapability({ supportedScopes: [] as any })
    expect(rejectedPaths({ ...validDefinition(), mcpServers })).toEqual(['mcpServers.supportedScopes'])
  })

  test('an unknown scope is rejected at its own index', () => {
    // biome-ignore lint/suspicious/noExplicitAny: simulating untyped JavaScript input
    const assets = assetCapability({ supportedScopes: ['project', 'system'] as any })
    expect(rejectedPaths({ ...validDefinition(), assets })).toEqual(['assets.supportedScopes.1'])
  })

  test('a repeated scope is rejected', () => {
    const assets = assetCapability({ supportedScopes: ['user', 'user'] })
    expect(rejectedPaths({ ...validDefinition(), assets })).toEqual(['assets.supportedScopes.1'])
  })

  test('a missing supported-scope declaration is rejected', () => {
    const { supportedScopes: _omitted, ...assets } = assetCapability()
    expect(rejectedPaths({ ...validDefinition(), assets })).toEqual(['assets.supportedScopes'])
  })

  test('a capability without its location declaration is rejected, naming the missing declaration', () => {
    const { locationEnvironment: _omitted, ...mcpServers } = mcpCapability()
    expect(rejectedPaths({ ...validDefinition(), mcpServers })).toEqual(['mcpServers.locationEnvironment'])
  })

  test('an invalid or repeated environment name is rejected at its index', () => {
    const assets = assetCapability({ locationEnvironment: ['XDG_CONFIG_HOME', 'NOT-PORTABLE', 'XDG_CONFIG_HOME'] })
    expect(rejectedPaths({ ...validDefinition(), assets })).toEqual([
      'assets.locationEnvironment.1',
      'assets.locationEnvironment.2',
    ])
  })

  test('a declined capability is preserved rather than stubbed', () => {
    const adapter = defined({ ...validDefinition(), assets: false, mcpServers: false })
    expect(adapter.assets).toBe(false)
    expect(adapter.mcpServers).toBe(false)
  })

  test('declarations on the returned adapter are frozen copies', () => {
    const supportedScopes: ['project', 'user'] = ['project', 'user']
    const adapter = defined({ ...validDefinition(), assets: assetCapability({ supportedScopes }) })
    if (adapter.assets === false) expect.unreachable()
    supportedScopes.pop()
    expect(adapter.assets.supportedScopes).toEqual(['project', 'user'])
    expect(Object.isFrozen(adapter.assets)).toBe(true)
    expect(Object.isFrozen(adapter.assets.supportedScopes)).toBe(true)
    expect(Object.isFrozen(adapter.assets.locationEnvironment)).toBe(true)
  })
})

describe('adapter SDK API identifier', () => {
  test('the SDK stamps the canonical identifier', () => {
    expect(defined(validDefinition()).apiVersion).toBe(ADAPTER_API_VERSION)
  })

  test('an author-supplied identifier is ignored, never honored', () => {
    // biome-ignore lint/suspicious/noExplicitAny: simulating untyped JavaScript input
    const result = defineAdapter({ ...validDefinition(), apiVersion: '0.3' } as any)
    if (!result.ok) expect.unreachable()
    expect(result.data.apiVersion).toBe('0.4')
  })

  test('the canonical identifier names the scope-aware planning contract', () => {
    expect(ADAPTER_API_VERSION).toBe('0.4')
  })

  test('the package-metadata field name is exported for release tooling', () => {
    expect(ADAPTER_API_VERSION_PACKAGE_FIELD).toBe('facetAdapterApiVersion')
  })
})

describe('adapter shape', () => {
  test('the returned adapter is frozen', () => {
    expect(Object.isFrozen(defined(validDefinition()))).toBe(true)
  })

  test('buildAssetMetadata is bound to the definition', () => {
    const definition: AdapterDefinition = {
      ...validDefinition(),
      buildAssetMetadata(this: { marker: string } & AdapterDefinition) {
        return { ok: true, data: { marker: this.marker } }
      },
    }
    Object.assign(definition, { marker: 'kept' })

    const result = defined(definition).buildAssetMetadata({})
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({ marker: 'kept' })
  })

  test('an adapter exposes exactly the contract members', () => {
    const adapter: Adapter = defined(validDefinition())
    expect(Object.keys(adapter).sort()).toEqual(['apiVersion', 'assets', 'buildAssetMetadata', 'mcpServers', 'name'])
  })
})

// --- The guard every capability call passes through ---

const PROJECT: PlanningContext = {
  target: { scope: 'project', projectRoot: '/work/app' },
  homeDirectory: '/home/alice',
  environment: {},
}

const USER: PlanningContext = { target: { scope: 'user' }, homeDirectory: '/home/alice', environment: {} }

function skillRequest(context: unknown, name = 'review'): PlanAssetInstallRequest {
  return {
    context,
    assetType: 'skill',
    name,
    content: '# review\n',
    metadata: {},
    companions: {},
    ownedCompanionPaths: [],
  } as PlanAssetInstallRequest
}

/** An asset capability that records every request its planner actually received. */
function recordingAssets(overrides: Partial<AssetCapability> = {}) {
  const received: PlanAssetInstallRequest[] = []
  const capability = assetCapability({
    async planInstall(request): Promise<PlanAssetInstallResult> {
      received.push(request)
      return {
        ok: true,
        plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: '/x/y.md', storageRoot: '/x' },
      }
    },
    ...overrides,
  })
  return { capability, received }
}

async function planWith(capability: AssetCapability, request: PlanAssetInstallRequest) {
  const adapter = defined({ ...validDefinition(), assets: capability })
  if (adapter.assets === false) expect.unreachable()
  return adapter.assets.planInstall(request)
}

describe('capability guard — refused before the planner runs', () => {
  test('a system target is refused as data naming system', async () => {
    const { capability, received } = recordingAssets()
    const result = await planWith(
      capability,
      skillRequest({ target: { scope: 'system' }, homeDirectory: '/h', environment: {} }),
    )

    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'unsupported-scope', scope: 'system', supportedScopes: ['project', 'user'] })
    expect(received).toEqual([])
  })

  test('a user target carrying a project root is malformed', async () => {
    const { capability, received } = recordingAssets()
    const result = await planWith(capability, skillRequest({ ...USER, target: { scope: 'user', projectRoot: '/w' } }))

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'invalid-target') expect.unreachable()
    expect(result.failure.field).toBe('context.target.projectRoot')
    expect(received).toEqual([])
  })

  test('a project target without a project root is malformed', async () => {
    const { capability, received } = recordingAssets()
    const result = await planWith(capability, skillRequest({ ...PROJECT, target: { scope: 'project' } }))

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'invalid-target') expect.unreachable()
    expect(result.failure.field).toBe('context.target.projectRoot')
    expect(received).toEqual([])
  })

  test('a relative home is refused before inspection', async () => {
    const { capability, received } = recordingAssets()
    const result = await planWith(capability, skillRequest({ ...USER, homeDirectory: 'alice' }))

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'invalid-target') expect.unreachable()
    expect(result.failure.field).toBe('context.homeDirectory')
    expect(received).toEqual([])
  })

  test('a scope outside the capability declaration names the declared scopes', async () => {
    const { capability, received } = recordingAssets({ supportedScopes: ['project'] })
    const result = await planWith(capability, skillRequest(USER))

    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'unsupported-scope', scope: 'user', supportedScopes: ['project'] })
    expect(received).toEqual([])
  })

  test('an unsafe asset name is refused as data', async () => {
    const { capability, received } = recordingAssets()
    const result = await planWith(capability, skillRequest(USER, '../escape'))

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-asset-name')
    expect(received).toEqual([])
  })

  test('a missing context is malformed', async () => {
    const { capability, received } = recordingAssets()
    const result = await planWith(capability, skillRequest(undefined))

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'invalid-target') expect.unreachable()
    expect(result.failure.field).toBe('context')
    expect(received).toEqual([])
  })

  test('the MCP capability is guarded the same way', async () => {
    let called = false
    const adapter = defined({
      ...validDefinition(),
      mcpServers: mcpCapability({
        supportedScopes: ['project'],
        async plan() {
          called = true
          return { ok: true, plan: { outcomes: [], documentPaths: ['/a'], action: { kind: 'unchanged' } } }
        },
      }),
    })
    if (adapter.mcpServers === false) expect.unreachable()
    const request: PlanMcpServersRequest = { context: USER, desired: [], previouslyOwnedNames: [] }

    const result = await adapter.mcpServers.plan(request)

    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'unsupported-scope', scope: 'user', supportedScopes: ['project'] })
    expect(called).toBe(false)
  })
})

describe('capability guard — what the planner receives', () => {
  test('only declared variables reach the capability', async () => {
    const { capability, received } = recordingAssets({ locationEnvironment: ['XDG_CONFIG_HOME'] })
    await planWith(
      capability,
      skillRequest({ ...USER, environment: { XDG_CONFIG_HOME: '/home/alice/.xdg', AWS_SECRET_ACCESS_KEY: 'secret' } }),
    )

    expect(received).toHaveLength(1)
    expect(received[0]?.context.environment).toEqual({ XDG_CONFIG_HOME: '/home/alice/.xdg' })
  })

  test('an empty declaration receives an empty snapshot', async () => {
    const { capability, received } = recordingAssets()
    await planWith(capability, skillRequest({ ...USER, environment: { HOME: '/elsewhere' } }))
    expect(received[0]?.context.environment).toEqual({})
  })

  test('the supplied context cannot be changed by the planner', async () => {
    let attempt: unknown
    const { capability } = recordingAssets({
      locationEnvironment: ['CODEX_HOME'],
      async planInstall(request) {
        const environment = request.context.environment as Record<string, string | undefined>
        try {
          environment.CODEX_HOME = '/tampered'
        } catch (error) {
          attempt = error
        }
        expect(Object.isFrozen(request.context)).toBe(true)
        expect(Object.isFrozen(request.context.target)).toBe(true)
        expect(environment.CODEX_HOME).toBe('/opt/codex')
        return {
          ok: true,
          plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: '/x/y.md', storageRoot: '/x' },
        }
      },
    })
    const supplied = { ...USER, environment: { CODEX_HOME: '/opt/codex' } }

    const result = await planWith(capability, skillRequest(supplied))

    if (!result.ok) expect.unreachable()
    expect(attempt).toBeInstanceOf(TypeError)
    expect(supplied.environment.CODEX_HOME).toBe('/opt/codex')
  })

  test('the planner receives a valid context unchanged in meaning', async () => {
    const { capability, received } = recordingAssets()
    await planWith(capability, skillRequest(PROJECT))
    expect(received[0]?.context).toEqual(PROJECT)
    expect(received[0]?.name).toBe('review')
  })

  test('ambient process state does not reach the planner', async () => {
    const { capability, received } = recordingAssets({ locationEnvironment: ['XDG_CONFIG_HOME'] })
    const previous = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = '/ambient'
    try {
      await planWith(capability, skillRequest(USER))
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
    }
    expect(received[0]?.context.environment).toEqual({})
    expect(received[0]?.context.homeDirectory).toBe('/home/alice')
  })
})

describe('protocol declaration identity', () => {
  test('the SDK re-exports the protocol declaration type rather than restating it', () => {
    // Assignable in both directions: one type, two names. A structural copy
    // would drift the moment the protocol adds a field.
    const protocolValue: ProtocolMcpServerDeclaration = { type: 'stdio', command: 'srv' }
    const sdkValue: McpServerDeclaration = protocolValue
    const roundTripped: ProtocolMcpServerDeclaration = sdkValue
    expect(roundTripped).toBe(protocolValue)
  })

  test('a contribution carries the declaration unchanged', () => {
    const declaration: McpServerDeclaration = { type: 'http', url: 'https://example.test/mcp' }
    const contribution: McpServerContribution = { name: 'remote', declaration }
    expect(contribution.declaration).toBe(declaration)
  })
})
