import { describe, expect, test } from 'bun:test'
import {
  canonicalMcpServerEncoding,
  computeMcpServerFingerprint,
  FacetManifestSchema,
  type FacetMaterializationOverrides,
  LegacyFacetManifestSchema,
  LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING,
  type LockedServerContribution,
  MCP_SERVER_FINGERPRINT_ENCODING,
  type McpServerDeclaration,
  McpServerDeclarationSchema,
  type PlanServerMaterializationResult,
  planLockedServerInventory,
  planServerMaterialization,
  type ServerContribution,
  validateMcpEnvironmentName,
  validateMcpServerName,
} from '@agent-facets/protocol'
import { type } from 'arktype'

const accepts = (value: unknown): boolean => !(McpServerDeclarationSchema(value) instanceof type.errors)

const errorsFor = (value: unknown): InstanceType<typeof type.errors> => {
  const result = McpServerDeclarationSchema(value)
  if (!(result instanceof type.errors)) expect.unreachable()
  return result
}

const manifest = (extra: Record<string, unknown>): unknown => ({ name: 'demo', version: '1.0.0', ...extra })

// --- Declaration schema ---

describe('McpServerDeclarationSchema — accepted declarations', () => {
  test('minimal standard-input declaration', () => {
    expect(accepts({ type: 'stdio', command: 'npx' })).toBe(true)
  })

  test('standard-input declaration with ordered args and literal env', () => {
    expect(
      accepts({ type: 'stdio', command: 'npx', args: ['-y', 'server'], env: { API_MODE: 'live', _FLAG: '1' } }),
    ).toBe(true)
  })

  test('empty optional collections are accepted', () => {
    expect(accepts({ type: 'stdio', command: 'npx', args: [], env: {} })).toBe(true)
  })

  test('absolute https and http URLs', () => {
    expect(accepts({ type: 'http', url: 'https://mcp.example.com/sse' })).toBe(true)
    expect(accepts({ type: 'http', url: 'http://localhost:3000/mcp' })).toBe(true)
  })
})

describe('McpServerDeclarationSchema — rejected declarations', () => {
  test('empty command', () => {
    expect(errorsFor({ type: 'stdio', command: '' }).summary).toContain('non-empty command')
  })

  test('missing transport tag', () => {
    expect(accepts({ command: 'npx' })).toBe(false)
  })

  test('cross-arm fields are rejected at their own path', () => {
    expect(errorsFor({ type: 'stdio', command: 'x', url: 'https://a.example' }).summary).toContain('url')
    expect(errorsFor({ type: 'http', url: 'https://a.example', command: 'x' }).summary).toContain('command')
  })

  test('unrecognized execution-affecting members are rejected', () => {
    for (const member of ['headers', 'cwd', 'shell']) {
      expect(errorsFor({ type: 'stdio', command: 'x', [member]: {} }).summary).toContain(member)
    }
  })

  test('relative, file, and websocket URLs', () => {
    expect(accepts({ type: 'http', url: '/mcp' })).toBe(false)
    expect(accepts({ type: 'http', url: 'file:///tmp/x' })).toBe(false)
    expect(accepts({ type: 'http', url: 'ws://a.example' })).toBe(false)
    expect(accepts({ type: 'http', url: 'wss://a.example' })).toBe(false)
  })

  test('URL embedding credentials', () => {
    expect(errorsFor({ type: 'http', url: 'https://user:pass@a.example/mcp' }).summary).toContain('credentials')
  })

  test('non-literal environment values', () => {
    expect(accepts({ type: 'stdio', command: 'x', env: { A: 1 } })).toBe(false)
  })

  test('invalid environment names', () => {
    for (const name of ['1BAD', 'A-B', 'A.B', '']) {
      expect(accepts({ type: 'stdio', command: 'x', env: { [name]: 'v' } })).toBe(false)
    }
  })
})

describe('McpServerDeclarationSchema — failures locate the invalid field', () => {
  const pathsFor = (value: unknown): string[][] =>
    [...errorsFor(value)].map((error) => error.path.map((segment) => String(segment)))

  test('an empty command is reported at the command member', () => {
    expect(pathsFor({ type: 'stdio', command: '' })).toContainEqual(['command'])
  })

  test('an invalid URL is reported at the url member', () => {
    expect(pathsFor({ type: 'http', url: '/mcp' })).toContainEqual(['url'])
    expect(pathsFor({ type: 'http', url: 'https://user:pass@a.example/mcp' })).toContainEqual(['url'])
  })

  test('an invalid environment name is reported at its own key', () => {
    expect(pathsFor({ type: 'stdio', command: 'x', env: { GOOD: 'v', '1BAD': 'v' } })).toContainEqual(['env', '1BAD'])
  })

  test('every invalid environment name is reported', () => {
    const paths = pathsFor({ type: 'stdio', command: 'x', env: { '1BAD': 'v', 'A-B': 'v' } })
    expect(paths).toContainEqual(['env', '1BAD'])
    expect(paths).toContainEqual(['env', 'A-B'])
  })
})

describe('manifest validation locates the invalid declaration member', () => {
  const manifestPaths = (value: unknown): string[] => {
    const result = FacetManifestSchema(value)
    if (!(result instanceof type.errors)) expect.unreachable()
    return [...result].map((error) => error.path.join('.'))
  }

  test('an empty command is reported under the server', () => {
    expect(manifestPaths(manifest({ servers: { fs: { type: 'stdio', command: '' } } }))).toContain('servers.fs.command')
  })

  test('an invalid URL is reported under the server', () => {
    expect(manifestPaths(manifest({ servers: { docs: { type: 'http', url: 'ws://a.example' } } }))).toContain(
      'servers.docs.url',
    )
  })

  test('an invalid environment name is reported at its key under the server', () => {
    expect(
      manifestPaths(manifest({ servers: { fs: { type: 'stdio', command: 'x', env: { '1BAD': 'v' } } } })),
    ).toContain('servers.fs.env.1BAD')
  })
})

describe('portable name grammars', () => {
  test('server names follow the single-segment asset grammar', () => {
    for (const name of ['a', 'filesystem', 'review2', 'code-review']) {
      expect(validateMcpServerName(name).ok).toBe(true)
    }
    for (const name of ['Bad', 'a_b', 'a/b', '-a', 'a-', 'a--b', '']) {
      expect(validateMcpServerName(name).ok).toBe(false)
    }
  })

  test('environment names are portable ASCII', () => {
    for (const name of ['PATH', '_private', 'a1', 'A_B_2']) {
      expect(validateMcpEnvironmentName(name).ok).toBe(true)
    }
    for (const name of ['1A', 'A-B', 'A B', 'é', '']) {
      expect(validateMcpEnvironmentName(name).ok).toBe(false)
    }
  })
})

// --- Manifest integration ---

describe('facet manifests carrying MCP declarations', () => {
  test('a server is a sufficient deliverable on its own', () => {
    const result = FacetManifestSchema(manifest({ servers: { fs: { type: 'stdio', command: 'npx' } } }))
    expect(result).not.toBeInstanceOf(type.errors)
  })

  test('a server and a text asset may share a name', () => {
    const result = FacetManifestSchema(
      manifest({
        skills: { review: { description: 'd' } },
        servers: { review: { type: 'http', url: 'https://a.example/mcp' } },
      }),
    )
    expect(result).not.toBeInstanceOf(type.errors)
  })

  test('an invalid server name identifies the server', () => {
    const result = FacetManifestSchema(manifest({ servers: { Bad_Name: { type: 'stdio', command: 'x' } } }))
    if (!(result instanceof type.errors)) expect.unreachable()
    expect(result.summary).toContain('Bad_Name')
  })

  test('speculative version-string and image references are rejected', () => {
    expect(FacetManifestSchema(manifest({ servers: { fs: '1.0.0' } }))).toBeInstanceOf(type.errors)
    expect(FacetManifestSchema(manifest({ servers: { fs: { image: 'ghcr.io/a/b:v1' } } }))).toBeInstanceOf(type.errors)
  })

  test('top-level extensions stay tolerated alongside closed declarations', () => {
    const result = FacetManifestSchema(manifest({ license: 'MIT', servers: { fs: { type: 'stdio', command: 'npx' } } }))
    expect(result).not.toBeInstanceOf(type.errors)
    expect((result as Record<string, unknown>).license).toBe('MIT')
  })

  test('a legacy manifest may not declare servers in any form', () => {
    const withServers = { name: 'demo', version: '1.0.0', skills: { a: { description: 'd' } }, servers: {} }
    expect(LegacyFacetManifestSchema(withServers)).toBeInstanceOf(type.errors)
    expect(LegacyFacetManifestSchema({ ...withServers, servers: { fs: '1.0.0' } })).toBeInstanceOf(type.errors)
  })

  test('a legacy text-only manifest remains valid', () => {
    const result = LegacyFacetManifestSchema({
      name: 'demo',
      version: '1.0.0',
      skills: { 'ns/a': { description: 'd' } },
    })
    expect(result).not.toBeInstanceOf(type.errors)
  })
})

// --- Canonical fingerprint ---

describe('computeMcpServerFingerprint', () => {
  const stdio = (extra: Partial<Extract<McpServerDeclaration, { type: 'stdio' }>>): McpServerDeclaration => ({
    type: 'stdio',
    command: 'npx',
    ...extra,
  })

  test('emits the repository-wide sha256 form', () => {
    expect(computeMcpServerFingerprint(stdio({}))).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test('environment order does not change the fingerprint', () => {
    expect(computeMcpServerFingerprint(stdio({ env: { B: '2', A: '1' } }))).toBe(
      computeMcpServerFingerprint(stdio({ env: { A: '1', B: '2' } })),
    )
  })

  test('omitted optional collections equal empty ones', () => {
    expect(computeMcpServerFingerprint(stdio({}))).toBe(computeMcpServerFingerprint(stdio({ args: [], env: {} })))
  })

  test('argument order changes the fingerprint', () => {
    expect(computeMcpServerFingerprint(stdio({ args: ['a', 'b'] }))).not.toBe(
      computeMcpServerFingerprint(stdio({ args: ['b', 'a'] })),
    )
  })

  test('environment values change the fingerprint', () => {
    expect(computeMcpServerFingerprint(stdio({ env: { A: '1' } }))).not.toBe(
      computeMcpServerFingerprint(stdio({ env: { A: '2' } })),
    )
  })

  test('transports never collide', () => {
    expect(computeMcpServerFingerprint(stdio({}))).not.toBe(
      computeMcpServerFingerprint({ type: 'http', url: 'https://a.example' }),
    )
  })

  test('the canonical encoding is tagged, positional, and sorted', () => {
    expect(canonicalMcpServerEncoding(stdio({ args: ['-y'], env: { B: '2', A: '1' } }))).toBe(
      '["facets:mcp-server:v1","stdio","npx",["-y"],[["A","1"],["B","2"]]]',
    )
    expect(canonicalMcpServerEncoding({ type: 'http', url: 'https://a.example/mcp' })).toBe(
      '["facets:mcp-server:v1","http","https://a.example/mcp"]',
    )
  })
})

// --- Encoding binding and fixed vectors ---

describe('fingerprint encoding identifiers', () => {
  test('the encoder publishes its encoding identifier', () => {
    expect(MCP_SERVER_FINGERPRINT_ENCODING).toBe('facets:mcp-server:v1')
  })

  test('lockfile 0.4 is bound to facets:mcp-server:v1 by its own literal', () => {
    expect(LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING).toBe('facets:mcp-server:v1')
  })

  test('the current encoder agrees with the 0.4 binding', () => {
    expect(MCP_SERVER_FINGERPRINT_ENCODING).toBe(LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING)
  })
})

/**
 * Fixed vectors for the `0.4` binding. The digests were computed outside this
 * implementation from the literal preimage bytes, so a change to either the
 * encoder or the hash fails here even if both sides changed together. Never
 * update these to match new output: a different digest is a new encoding.
 */
describe('facets:mcp-server:v1 fixed vectors', () => {
  test('standard-input preimage and digest', () => {
    const declaration: McpServerDeclaration = { type: 'stdio', command: 'npx' }
    expect(canonicalMcpServerEncoding(declaration)).toBe('["facets:mcp-server:v1","stdio","npx",[],[]]')
    expect(computeMcpServerFingerprint(declaration)).toBe(
      'sha256:6424550ee92491465134168e17c8c43082b58ad834e436318c4a5eb8ec14db91',
    )
  })

  test('HTTP preimage and digest', () => {
    const declaration: McpServerDeclaration = { type: 'http', url: 'https://example.com/mcp' }
    expect(canonicalMcpServerEncoding(declaration)).toBe('["facets:mcp-server:v1","http","https://example.com/mcp"]')
    expect(computeMcpServerFingerprint(declaration)).toBe(
      'sha256:490eeb871c13796d932d8d80f8eda0748a1cb1f9afa02536c4f8bddabd6dbbd5',
    )
  })

  test('the preimage is compact JSON with literal values', () => {
    const encoding = canonicalMcpServerEncoding({
      type: 'stdio',
      command: 'run me',
      args: ['--flag', 'a b'],
      env: { Z: ' spaced ', A: '$HOME' },
    })
    expect(encoding).toBe('["facets:mcp-server:v1","stdio","run me",["--flag","a b"],[["A","$HOME"],["Z"," spaced "]]]')
  })

  test('absent collections encode as empty arrays', () => {
    expect(canonicalMcpServerEncoding({ type: 'stdio', command: 'npx', args: [], env: {} })).toBe(
      '["facets:mcp-server:v1","stdio","npx",[],[]]',
    )
  })

  test('the fingerprint depends on neither server name nor contributing facet', () => {
    const declaration: McpServerDeclaration = { type: 'stdio', command: 'npx' }
    const result = planServerMaterialization([
      { facet: 'from-registry', servers: [{ name: 'one', declaration }] },
      { facet: 'from-git', servers: [{ name: 'two', declaration }] },
      { facet: 'from-local', servers: [{ name: 'three', declaration }] },
    ])
    if (!result.ok) expect.unreachable()
    expect(new Set(result.planned.map((p) => p.fingerprint))).toEqual(
      new Set(['sha256:6424550ee92491465134168e17c8c43082b58ad834e436318c4a5eb8ec14db91']),
    )
  })
})

// --- Server materialization planning ---

describe('planServerMaterialization', () => {
  const stdio = (command: string): McpServerDeclaration => ({ type: 'stdio', command })

  test('identical declarations compose into one configuration retaining every claimant', () => {
    const result = planServerMaterialization([
      { facet: 'b', servers: [{ name: 'fs', declaration: stdio('x') }] },
      { facet: 'a', servers: [{ name: 'fs', declaration: stdio('x') }] },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.configurations).toHaveLength(1)
    expect(result.configurations[0]?.claimants.map((c) => c.facet)).toEqual(['a', 'b'])
  })

  test('differing declarations collide with every claimant named', () => {
    const result = planServerMaterialization([
      { facet: 'a', servers: [{ name: 'fs', declaration: stdio('x') }] },
      { facet: 'b', servers: [{ name: 'fs', declaration: stdio('y') }] },
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.members.map((m) => m.facet)).toEqual(['a', 'b'])
  })

  test('an alias resolves a collision without touching the authored name', () => {
    const result = planServerMaterialization([
      {
        facet: 'a',
        servers: [{ name: 'fs', declaration: stdio('x') }],
        overrides: { servers: { fs: { kind: 'aliased', as: 'project-fs' } } },
      },
      { facet: 'b', servers: [{ name: 'fs', declaration: stdio('y') }] },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.configurations.map((c) => c.identity.effectiveName)).toEqual(['fs', 'project-fs'])
    expect(result.planned.map((p) => p.authoredName)).toEqual(['fs', 'fs'])
  })

  test('an omitted server leaves the effective set but stays planned', () => {
    const result = planServerMaterialization([
      {
        facet: 'a',
        servers: [{ name: 'fs', declaration: stdio('x') }],
        overrides: { servers: { fs: { kind: 'omitted' } } },
      },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.configurations).toHaveLength(0)
    expect(result.planned[0]?.disposition.kind).toBe('omitted')
  })

  test('an override naming no declared server is stale', () => {
    const result = planServerMaterialization([
      { facet: 'a', servers: [], overrides: { servers: { gone: { kind: 'omitted' } } } },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.staleOverrides).toEqual([{ facet: 'a', authoredName: 'gone', disposition: { kind: 'omitted' } }])
  })

  test('an invalid alias preempts every other report', () => {
    const result = planServerMaterialization([
      {
        facet: 'a',
        servers: [{ name: 'fs', declaration: stdio('x') }],
        overrides: { servers: { fs: { kind: 'aliased', as: 'Bad_Name' } } },
      },
    ])
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('invalid-alias')
  })

  test('inherited property names are treated as ordinary server names', () => {
    const result = planServerMaterialization([
      {
        facet: 'a',
        servers: [
          { name: 'constructor', declaration: stdio('x') },
          { name: 'toString', declaration: stdio('y') },
        ],
      },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.planned.every((p) => p.disposition.kind === 'authored')).toBe(true)
    expect(result.staleOverrides).toEqual([])
  })

  test('the result shares no mutable structure with the input', () => {
    const override = { kind: 'aliased', as: 'project-fs' } as const
    const overrides = { servers: { fs: override } }
    const result = planServerMaterialization([
      { facet: 'a', servers: [{ name: 'fs', declaration: stdio('x') }], overrides },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.planned[0]?.disposition).not.toBe(override)
    expect(result.configurations[0]?.claimants[0]?.disposition).not.toBe(override)
  })

  test('the planned declaration is a clone of the input, not the input itself', () => {
    const declaration: McpServerDeclaration = { type: 'stdio', command: 'x', args: ['--a'], env: { A: '1' } }
    const result = planServerMaterialization([{ facet: 'a', servers: [{ name: 'fs', declaration }] }])
    if (!result.ok) expect.unreachable()

    expect(result.planned[0]?.declaration).not.toBe(declaration)
    expect(result.planned[0]?.declaration).toEqual(declaration)
  })

  test('every view shares one declaration object per contribution', () => {
    const result = planServerMaterialization([
      { facet: 'a', servers: [{ name: 'fs', declaration: stdio('x') }] },
      { facet: 'b', servers: [{ name: 'fs', declaration: stdio('x') }] },
    ])
    if (!result.ok) expect.unreachable()

    // The composed configuration reuses the first claimant's clone rather than
    // making a third object that could drift from either planned entry.
    expect(result.configurations[0]?.declaration).toBe(result.planned[0]?.declaration)
  })

  test('a planned declaration is frozen at runtime, including args and env', () => {
    const result = planServerMaterialization([
      {
        facet: 'a',
        servers: [{ name: 'fs', declaration: { type: 'stdio', command: 'x', args: ['--a'], env: { A: '1' } } }],
      },
    ])
    if (!result.ok) expect.unreachable()
    const planned = result.planned[0]?.declaration
    if (planned?.type !== 'stdio') expect.unreachable()

    expect(Object.isFrozen(planned)).toBe(true)
    expect(Object.isFrozen(planned.args)).toBe(true)
    expect(Object.isFrozen(planned.env)).toBe(true)
  })

  test('mutating the input afterwards changes neither the plan nor its fingerprint', () => {
    const declaration: McpServerDeclaration = { type: 'stdio', command: 'x', args: ['--a'], env: { A: '1' } }
    const result = planServerMaterialization([{ facet: 'a', servers: [{ name: 'fs', declaration }] }])
    if (!result.ok) expect.unreachable()
    const before = result.configurations[0]?.fingerprint
    if (before === undefined) expect.unreachable()

    declaration.command = 'y'
    declaration.args?.push('--b')
    if (declaration.env) declaration.env.A = '2'

    const planned = result.configurations[0]?.declaration
    if (planned?.type !== 'stdio') expect.unreachable()
    expect(planned.command).toBe('x')
    expect(planned.args).toEqual(['--a'])
    expect(planned.env).toEqual({ A: '1' })
    expect(result.configurations[0]?.fingerprint).toBe(before)
    expect(computeMcpServerFingerprint(planned)).toBe(before)
  })

  test('collision members carry the same frozen clone as the input allows', () => {
    const result = planServerMaterialization([
      { facet: 'a', servers: [{ name: 'fs', declaration: stdio('x') }] },
      { facet: 'b', servers: [{ name: 'fs', declaration: stdio('y') }] },
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()

    for (const member of result.groups[0]?.members ?? []) {
      expect(Object.isFrozen(member.declaration)).toBe(true)
    }
  })

  test('planning is independent of input order', () => {
    const one = planServerMaterialization([
      { facet: 'a', servers: [{ name: 'b', declaration: stdio('x') }] },
      { facet: 'b', servers: [{ name: 'a', declaration: stdio('y') }] },
    ])
    const two = planServerMaterialization([
      { facet: 'b', servers: [{ name: 'a', declaration: stdio('y') }] },
      { facet: 'a', servers: [{ name: 'b', declaration: stdio('x') }] },
    ])
    expect(one).toEqual(two)
  })
})

// --- Fingerprint-only planning ---

describe('planLockedServerInventory', () => {
  const X = computeMcpServerFingerprint({ type: 'stdio', command: 'x' })
  const Y = computeMcpServerFingerprint({ type: 'stdio', command: 'y' })

  test('a missing override means authored, not a remembered alias', () => {
    const result = planLockedServerInventory([{ facet: 'a', servers: [{ name: 'fs', fingerprint: X }] }])
    if (!result.ok) expect.unreachable()
    expect(result.planned).toEqual([
      { facet: 'a', authoredName: 'fs', fingerprint: X, disposition: { kind: 'authored' } },
    ])
    expect(result.configurations.map((c) => c.identity.effectiveName)).toEqual(['fs'])
  })

  test('identical fingerprints compose and keep every claimant', () => {
    const result = planLockedServerInventory([
      { facet: 'b', servers: [{ name: 'fs', fingerprint: X }] },
      { facet: 'a', servers: [{ name: 'fs', fingerprint: X }] },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.configurations).toEqual([
      {
        identity: { kind: 'mcp-server', effectiveName: 'fs' },
        key: 'mcp-server\u0000fs',
        fingerprint: X,
        claimants: [
          { facet: 'a', authoredName: 'fs', disposition: { kind: 'authored' } },
          { facet: 'b', authoredName: 'fs', disposition: { kind: 'authored' } },
        ],
      },
    ])
  })

  test('alias swaps are planned in one pass', () => {
    const result = planLockedServerInventory([
      {
        facet: 'a',
        servers: [
          { name: 'alpha', fingerprint: X },
          { name: 'beta', fingerprint: Y },
        ],
        overrides: { servers: { alpha: { kind: 'aliased', as: 'beta' }, beta: { kind: 'aliased', as: 'alpha' } } },
      },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.configurations.map((c) => [c.identity.effectiveName, c.fingerprint])).toEqual([
      ['alpha', Y],
      ['beta', X],
    ])
  })

  test('an empty facet still reports stale server intent', () => {
    const result = planLockedServerInventory([
      { facet: 'a', servers: [], overrides: { servers: { gone: { kind: 'omitted' } } } },
    ])
    if (!result.ok) expect.unreachable()
    expect(result.staleOverrides).toEqual([{ facet: 'a', authoredName: 'gone', disposition: { kind: 'omitted' } }])
  })

  test('an invalid alias is not a collision', () => {
    const result = planLockedServerInventory([
      {
        facet: 'a',
        servers: [{ name: 'fs', fingerprint: X }],
        overrides: { servers: { fs: { kind: 'aliased', as: 'Bad_Name' } } },
      },
      { facet: 'b', servers: [{ name: 'fs', fingerprint: Y }] },
    ])
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('invalid-alias')
  })

  test('a collision keeps unrelated stale diagnostics and selects nothing', () => {
    const result = planLockedServerInventory([
      { facet: 'a', servers: [{ name: 'fs', fingerprint: X }] },
      { facet: 'b', servers: [{ name: 'fs', fingerprint: Y }], overrides: { servers: { gone: { kind: 'omitted' } } } },
      { facet: 'c', servers: [{ name: 'clean', fingerprint: X }] },
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups).toEqual([
      {
        effectiveName: 'fs',
        members: [
          { facet: 'a', authoredName: 'fs', effectiveName: 'fs', fingerprint: X, disposition: { kind: 'authored' } },
          { facet: 'b', authoredName: 'fs', effectiveName: 'fs', fingerprint: Y, disposition: { kind: 'authored' } },
        ],
      },
    ])
    expect(result.staleOverrides).toEqual([{ facet: 'b', authoredName: 'gone', disposition: { kind: 'omitted' } }])
    expect(Object.hasOwn(result, 'configurations')).toBe(false)
  })

  test('results carry no declaration payload', () => {
    const result = planLockedServerInventory([{ facet: 'a', servers: [{ name: 'fs', fingerprint: X }] }])
    if (!result.ok) expect.unreachable()
    expect(Object.hasOwn(result.planned[0] as object, 'declaration')).toBe(false)
    expect(Object.hasOwn(result.configurations[0] as object, 'declaration')).toBe(false)
  })

  test('mutating the input afterwards does not change the result', () => {
    const override: { kind: 'aliased'; as: string } = { kind: 'aliased', as: 'project-fs' }
    const servers = [{ name: 'fs', fingerprint: X }]
    const overrides = { servers: { fs: override } }
    const result = planLockedServerInventory([{ facet: 'a', servers, overrides }])
    if (!result.ok) expect.unreachable()
    const snapshot = structuredClone(result)

    override.as = 'other'
    servers.push({ name: 'late', fingerprint: Y })
    ;(servers[0] as { fingerprint: string }).fingerprint = Y

    expect(result).toEqual(snapshot)
    expect(result.planned[0]?.disposition).not.toBe(override)
    expect(result.configurations[0]?.claimants[0]?.disposition).not.toBe(override)
  })
})

// --- Declaration planning and fingerprint planning agree ---

describe('planLockedServerInventory agrees with planServerMaterialization', () => {
  const decl = (command: string): McpServerDeclaration => ({ type: 'stdio', command })

  /** The declaration planner's result with every declaration payload removed. */
  function withoutDeclarations(result: PlanServerMaterializationResult): unknown {
    if (!result.ok) {
      if (result.reason === 'invalid-alias') return result
      return {
        ...result,
        groups: result.groups.map((group) => ({
          effectiveName: group.effectiveName,
          members: group.members.map(({ declaration: _, ...rest }) => rest),
        })),
      }
    }
    return {
      ok: true,
      planned: result.planned.map(({ declaration: _, ...rest }) => rest),
      configurations: result.configurations.map(({ declaration: _, ...rest }) => rest),
      staleOverrides: result.staleOverrides,
    }
  }

  function locked(contributions: readonly ServerContribution[]): LockedServerContribution[] {
    return contributions.map((contribution) => ({
      facet: contribution.facet,
      servers: contribution.servers.map((server) => ({
        name: server.name,
        fingerprint: computeMcpServerFingerprint(server.declaration),
      })),
      overrides: contribution.overrides,
    }))
  }

  /** Every arrangement of facet order crossed with forward/reversed server order. */
  function permutations(contributions: readonly ServerContribution[]): ServerContribution[][] {
    const orders: ServerContribution[][] = [[]]
    for (const contribution of contributions) {
      const next: ServerContribution[][] = []
      for (const order of orders) {
        for (let i = 0; i <= order.length; i++) next.push([...order.slice(0, i), contribution, ...order.slice(i)])
      }
      orders.splice(0, orders.length, ...next)
    }
    return orders.flatMap((order) => [
      order,
      order.map((contribution) => ({ ...contribution, servers: [...contribution.servers].reverse() })),
    ])
  }

  const overrides = (servers: FacetMaterializationOverrides['servers']): FacetMaterializationOverrides => ({ servers })

  const fixtures: Record<string, ServerContribution[]> = {
    'no contributions': [],
    'stale override on an empty facet': [
      { facet: 'a', servers: [], overrides: overrides({ gone: { kind: 'omitted' } }) },
    ],
    'missing override means authored': [{ facet: 'a', servers: [{ name: 'fs', declaration: decl('x') }] }],
    'identical declarations across facets': [
      { facet: 'a', servers: [{ name: 'fs', declaration: decl('x') }] },
      { facet: 'b', servers: [{ name: 'fs', declaration: decl('x') }] },
    ],
    'alias swap': [
      {
        facet: 'a',
        servers: [
          { name: 'alpha', declaration: decl('x') },
          { name: 'beta', declaration: decl('y') },
        ],
        overrides: overrides({ alpha: { kind: 'aliased', as: 'beta' }, beta: { kind: 'aliased', as: 'alpha' } }),
      },
    ],
    'two authored names from one facet compose': [
      {
        facet: 'a',
        servers: [
          { name: 'one', declaration: decl('x') },
          { name: 'two', declaration: decl('x') },
        ],
        overrides: overrides({ two: { kind: 'aliased', as: 'one' } }),
      },
    ],
    'two authored names from one facet collide': [
      {
        facet: 'a',
        servers: [
          { name: 'one', declaration: decl('x') },
          { name: 'two', declaration: decl('y') },
        ],
        overrides: overrides({ two: { kind: 'aliased', as: 'one' } }),
      },
    ],
    'equal fingerprints at distinct identities': [
      {
        facet: 'a',
        servers: [
          { name: 'one', declaration: decl('x') },
          { name: 'two', declaration: decl('x') },
        ],
      },
    ],
    'omission removes a would-be collision': [
      {
        facet: 'a',
        servers: [{ name: 'fs', declaration: decl('x') }],
        overrides: overrides({ fs: { kind: 'omitted' } }),
      },
      { facet: 'b', servers: [{ name: 'fs', declaration: decl('y') }] },
    ],
    'alias resolves a collision': [
      {
        facet: 'a',
        servers: [{ name: 'fs', declaration: decl('x') }],
        overrides: overrides({ fs: { kind: 'aliased', as: 'project-fs' } }),
      },
      { facet: 'b', servers: [{ name: 'fs', declaration: decl('y') }] },
    ],
    'collision with unrelated stale intent': [
      { facet: 'a', servers: [{ name: 'fs', declaration: decl('x') }] },
      {
        facet: 'b',
        servers: [
          { name: 'clean', declaration: decl('z') },
          { name: 'fs', declaration: decl('y') },
        ],
        overrides: overrides({ gone: { kind: 'omitted' } }),
      },
    ],
    'invalid alias beside a collision': [
      {
        facet: 'a',
        servers: [{ name: 'fs', declaration: decl('x') }],
        overrides: overrides({ fs: { kind: 'aliased', as: 'Bad_Name' } }),
      },
      { facet: 'b', servers: [{ name: 'fs', declaration: decl('y') }] },
      { facet: 'c', servers: [{ name: 'fs', declaration: decl('z') }] },
    ],
  }

  for (const [name, contributions] of Object.entries(fixtures)) {
    test(name, () => {
      const expected = withoutDeclarations(planServerMaterialization(contributions))
      for (const order of permutations(contributions)) {
        expect(withoutDeclarations(planServerMaterialization(order))).toEqual(expected)
        expect<unknown>(planLockedServerInventory(locked(order))).toEqual(expected)
      }
    })
  }
})
