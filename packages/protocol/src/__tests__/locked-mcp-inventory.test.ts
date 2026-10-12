import { describe, expect, test } from 'bun:test'
import {
  type DeriveLockedMcpInventoryResult,
  deriveLockedMcpInventory,
  type LockedMcpServer,
  type McpServerFingerprint,
  parseLockfileDocument,
  type SupportedLockfile,
} from '@agent-facets/protocol'

const FP_X: McpServerFingerprint = `sha256:${'1'.repeat(64)}`
const FP_Y: McpServerFingerprint = `sha256:${'2'.repeat(64)}`
const FP_Z: McpServerFingerprint = `sha256:${'3'.repeat(64)}`

const REGISTRY = { kind: 'registry', registry: 'https://cafe.example' } as const
const GIT = { kind: 'git', url: 'https://git.example/team/facet.git', commit: 'abcdef0123456789' } as const
const LOCAL = { kind: 'local', path: '../local-facet' } as const

type Disposition = { kind: 'authored' } | { kind: 'aliased'; as: string } | { kind: 'omitted' }

function rec(name: string, fingerprint: string, materialization: Disposition = { kind: 'authored' }) {
  return { name, fingerprint, materialization }
}

function facet(
  servers: readonly object[],
  options: { source?: object; version?: string; integrity?: string; assets?: unknown[] } = {},
) {
  return {
    source: options.source ?? REGISTRY,
    version: options.version ?? '1.0.0',
    integrity: options.integrity ?? `sha256:${'f'.repeat(64)}`,
    assets: options.assets ?? [],
    servers,
  }
}

/** Parse through the published reader, so every fixture is a schema-valid input. */
function parse(document: unknown): SupportedLockfile {
  const result = parseLockfileDocument(JSON.stringify(document))
  if (!result.ok) expect.unreachable()
  return result.data.lockfile
}

function derive04(facets: Record<string, unknown>): DeriveLockedMcpInventoryResult {
  return deriveLockedMcpInventory(parse({ lockfileVersion: 0.4, facets }))
}

function success(result: DeriveLockedMcpInventoryResult) {
  if (!result.ok) expect.unreachable()
  return result
}

function collision(result: DeriveLockedMcpInventoryResult) {
  if (result.ok) expect.unreachable()
  if (result.reason !== 'collision') expect.unreachable()
  return result
}

describe('deriveLockedMcpInventory — public types', () => {
  type Assert<T extends true> = T
  // A selected server always has at least one origin, statically.
  type _OriginsNonEmpty = Assert<LockedMcpServer['origins'] extends readonly [unknown, ...unknown[]] ? true : false>
  // Derivation describes recorded state only; it has no override parameter.
  type _SingleParameter = Assert<Parameters<typeof deriveLockedMcpInventory>['length'] extends 1 ? true : false>

  test('derivation takes the lockfile and nothing else', () => {
    expect(deriveLockedMcpInventory.length).toBe(1)
  })
})

describe('deriveLockedMcpInventory — legacy formats', () => {
  test('an empty 0.2 document is unavailable, not empty', () => {
    expect(deriveLockedMcpInventory(parse({ lockfileVersion: 0.2, facets: {} }))).toEqual({
      ok: false,
      reason: 'inventory-unavailable',
      lockfileVersion: 0.2,
      requiredVersion: 0.4,
    })
  })

  test('an empty 0.3 document is unavailable, not empty', () => {
    expect(deriveLockedMcpInventory(parse({ lockfileVersion: 0.3, facets: {} }))).toEqual({
      ok: false,
      reason: 'inventory-unavailable',
      lockfileVersion: 0.3,
      requiredVersion: 0.4,
    })
  })

  test('a legacy servers extension resembling current records is not inventory', () => {
    for (const lockfileVersion of [0.2, 0.3]) {
      const lockfile = parse({ lockfileVersion, facets: { a: facet([rec('fs', FP_X)]) } })
      const result = deriveLockedMcpInventory(lockfile)
      if (result.ok) expect.unreachable()
      expect(result.reason).toBe('inventory-unavailable')
    }
  })
})

describe('deriveLockedMcpInventory — empty current inventories', () => {
  test('a 0.4 document with no facets succeeds empty', () => {
    expect(derive04({})).toEqual({ ok: true, authored: [], servers: [] })
  })

  test('facets that record servers: [] succeed empty', () => {
    expect(derive04({ a: facet([]), b: facet([]) })).toEqual({ ok: true, authored: [], servers: [] })
  })
})

describe('deriveLockedMcpInventory — provenance', () => {
  test('a server-only facet reports complete registry provenance', () => {
    const result = success(
      derive04({ docs: facet([rec('filesystem', FP_X)], { version: '2.3.4', integrity: `sha256:${'e'.repeat(64)}` }) }),
    )
    const origin = {
      facet: 'docs',
      source: REGISTRY,
      version: '2.3.4',
      facetIntegrity: `sha256:${'e'.repeat(64)}`,
      authoredName: 'filesystem',
    }
    expect(result.authored).toEqual([{ ...origin, fingerprint: FP_X, materialization: { kind: 'authored' } }])
    expect(result.servers).toEqual([
      {
        effectiveName: 'filesystem',
        fingerprint: FP_X,
        origins: [{ ...origin, materialization: { kind: 'authored' } }],
      },
    ])
  })

  test('git and local sources are reported with their own fields', () => {
    const result = success(
      derive04({ g: facet([rec('one', FP_X)], { source: GIT }), l: facet([rec('two', FP_Y)], { source: LOCAL }) }),
    )
    expect(result.authored.map((a) => a.source)).toEqual([GIT, LOCAL])
    expect(result.servers.map((s) => s.origins[0].source)).toEqual([GIT, LOCAL])
  })

  test('a mixed facet reports its servers alongside its assets', () => {
    const asset = {
      scope: 'project',
      type: 'command',
      name: 'deploy',
      materialization: { kind: 'authored' },
      files: [{ path: 'commands/deploy.md', integrity: `sha256:${'d'.repeat(64)}` }],
    }
    const result = success(derive04({ a: facet([rec('fs', FP_X)], { assets: [asset] }) }))
    expect(result.authored.map((a) => a.authoredName)).toEqual(['fs'])
  })

  test('an alias selects the effective name while provenance keeps the authored name', () => {
    const result = success(
      derive04({ a: facet([rec('filesystem', FP_X, { kind: 'aliased', as: 'workspace-files' })]) }),
    )
    expect(result.servers.map((s) => s.effectiveName)).toEqual(['workspace-files'])
    expect(result.servers[0]?.origins[0]?.authoredName).toBe('filesystem')
    expect(result.servers[0]?.origins[0]?.materialization).toEqual({ kind: 'aliased', as: 'workspace-files' })
    expect(result.authored[0]?.fingerprint).toBe(FP_X)
  })

  test('alias swaps are derived in one pass', () => {
    const result = success(
      derive04({
        a: facet([
          rec('alpha', FP_X, { kind: 'aliased', as: 'beta' }),
          rec('beta', FP_Y, { kind: 'aliased', as: 'alpha' }),
        ]),
      }),
    )
    expect(result.servers.map((s) => [s.effectiveName, s.fingerprint, s.origins[0].authoredName])).toEqual([
      ['alpha', FP_Y, 'beta'],
      ['beta', FP_X, 'alpha'],
    ])
  })
})

describe('deriveLockedMcpInventory — composition and origins', () => {
  test('identical declarations from two facets keep both complete origins', () => {
    const result = success(
      derive04({
        b: facet([rec('fs', FP_X)], { source: GIT, version: '2.0.0', integrity: `sha256:${'b'.repeat(64)}` }),
        a: facet([rec('fs', FP_X)], { version: '1.0.0', integrity: `sha256:${'a'.repeat(64)}` }),
      }),
    )
    expect(result.servers).toHaveLength(1)
    expect(result.servers[0]?.origins).toEqual([
      {
        facet: 'a',
        source: REGISTRY,
        version: '1.0.0',
        facetIntegrity: `sha256:${'a'.repeat(64)}`,
        authoredName: 'fs',
        materialization: { kind: 'authored' },
      },
      {
        facet: 'b',
        source: GIT,
        version: '2.0.0',
        facetIntegrity: `sha256:${'b'.repeat(64)}`,
        authoredName: 'fs',
        materialization: { kind: 'authored' },
      },
    ])
  })

  test('two authored names from one facet remain separate origins', () => {
    const result = success(derive04({ a: facet([rec('one', FP_X), rec('two', FP_X, { kind: 'aliased', as: 'one' })]) }))
    expect(result.servers).toHaveLength(1)
    expect(result.servers[0]?.origins.map((o) => [o.facet, o.authoredName])).toEqual([
      ['a', 'one'],
      ['a', 'two'],
    ])
  })

  test('an omitted claim is authored but not selected', () => {
    const result = success(derive04({ a: facet([rec('fs', FP_X)]), b: facet([rec('fs', FP_X, { kind: 'omitted' })]) }))
    expect(result.authored.map((a) => [a.facet, a.materialization.kind])).toEqual([
      ['a', 'authored'],
      ['b', 'omitted'],
    ])
    expect(result.servers[0]?.origins.map((o) => o.facet)).toEqual(['a'])
  })

  test('an omitted claim does not collide', () => {
    const result = success(derive04({ a: facet([rec('fs', FP_X)]), b: facet([rec('fs', FP_Y, { kind: 'omitted' })]) }))
    expect(result.servers.map((s) => s.fingerprint)).toEqual([FP_X])
  })

  test('an all-omitted inventory succeeds with an empty selection', () => {
    const result = success(
      derive04({ a: facet([rec('one', FP_X, { kind: 'omitted' }), rec('two', FP_Y, { kind: 'omitted' })]) }),
    )
    expect(result.servers).toEqual([])
    expect(result.authored.map((a) => a.authoredName)).toEqual(['one', 'two'])
  })

  test('equal fingerprints under distinct effective names stay separate', () => {
    const result = success(derive04({ a: facet([rec('one', FP_X)]), b: facet([rec('two', FP_X)]) }))
    expect(result.servers.map((s) => [s.effectiveName, s.fingerprint])).toEqual([
      ['one', FP_X],
      ['two', FP_X],
    ])
  })
})

describe('deriveLockedMcpInventory — collisions', () => {
  test('a conflict reports every claimant and the complete authored view, with no partial selection', () => {
    const result = collision(
      derive04({
        a: facet([rec('fs', FP_X)]),
        b: facet([rec('fs', FP_Y)], { source: LOCAL }),
        c: facet([rec('clean', FP_Z), rec('quiet', FP_Z, { kind: 'omitted' })]),
      }),
    )
    expect(Object.hasOwn(result, 'servers')).toBe(false)
    expect(result.authored.map((a) => [a.facet, a.authoredName])).toEqual([
      ['a', 'fs'],
      ['b', 'fs'],
      ['c', 'clean'],
      ['c', 'quiet'],
    ])
    expect(result.groups).toEqual([
      {
        effectiveName: 'fs',
        members: [
          {
            facet: 'a',
            source: REGISTRY,
            version: '1.0.0',
            facetIntegrity: `sha256:${'f'.repeat(64)}`,
            authoredName: 'fs',
            materialization: { kind: 'authored' },
            effectiveName: 'fs',
            fingerprint: FP_X,
          },
          {
            facet: 'b',
            source: LOCAL,
            version: '1.0.0',
            facetIntegrity: `sha256:${'f'.repeat(64)}`,
            authoredName: 'fs',
            materialization: { kind: 'authored' },
            effectiveName: 'fs',
            fingerprint: FP_Y,
          },
        ],
      },
    ])
  })

  test('an alias can create a conflict, and members record it', () => {
    const result = collision(
      derive04({ a: facet([rec('fs', FP_X)]), b: facet([rec('files', FP_Y, { kind: 'aliased', as: 'fs' })]) }),
    )
    expect(result.groups[0]?.members.map((m) => [m.facet, m.authoredName, m.effectiveName, m.materialization])).toEqual(
      [
        ['a', 'fs', 'fs', { kind: 'authored' }],
        ['b', 'files', 'fs', { kind: 'aliased', as: 'fs' }],
      ],
    )
  })

  test('every conflicting identity is its own group', () => {
    const result = collision(
      derive04({ a: facet([rec('one', FP_X), rec('two', FP_X)]), b: facet([rec('one', FP_Y), rec('two', FP_Y)]) }),
    )
    expect(result.groups.map((g) => g.effectiveName)).toEqual(['one', 'two'])
  })
})

describe('deriveLockedMcpInventory — recorded state only', () => {
  test('a replaced but syntactically valid fingerprint is reported as recorded', () => {
    const result = success(derive04({ a: facet([rec('fs', FP_Z)]) }))
    expect(result.servers[0]?.fingerprint).toBe(FP_Z)
    expect(result.authored[0]?.fingerprint).toBe(FP_Z)
  })

  test('recorded dispositions are used regardless of any other project intent', () => {
    // There is no way to pass manifest intent; a project that has since
    // removed this alias still reads the recorded one.
    const result = success(derive04({ a: facet([rec('fs', FP_X, { kind: 'aliased', as: 'project-fs' })]) }))
    expect(result.servers.map((s) => s.effectiveName)).toEqual(['project-fs'])
  })

  test('output carries no installation, approval, or ownership field', () => {
    const result = success(derive04({ a: facet([rec('fs', FP_X)]) }))
    expect(Object.keys(result).sort()).toEqual(['authored', 'ok', 'servers'])
    expect(Object.keys(result.servers[0] as object).sort()).toEqual(['effectiveName', 'fingerprint', 'origins'])
    expect(Object.keys(result.servers[0]?.origins[0] as object).sort()).toEqual([
      'authoredName',
      'facet',
      'facetIntegrity',
      'materialization',
      'source',
      'version',
    ])
  })
})

describe('deriveLockedMcpInventory — determinism and isolation', () => {
  test('facet member order does not change the result', () => {
    const facets = {
      a: facet([rec('fs', FP_X)]),
      b: facet([rec('fs', FP_X), rec('other', FP_Y)]),
      c: facet([rec('extra', FP_Z, { kind: 'aliased', as: 'aaa' })]),
    }
    const forward = derive04(facets)
    const reversed = derive04(Object.fromEntries(Object.entries(facets).reverse()))
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward))
    const result = success(forward)
    expect(result.servers.map((s) => s.effectiveName)).toEqual(['aaa', 'fs', 'other'])
  })

  test('collision output is independent of facet order', () => {
    const facets = { a: facet([rec('fs', FP_X)]), b: facet([rec('fs', FP_Y)]), c: facet([rec('fs', FP_Z)]) }
    expect(JSON.stringify(derive04(Object.fromEntries(Object.entries(facets).reverse())))).toBe(
      JSON.stringify(derive04(facets)),
    )
  })

  test('unusual facet keys are ordinary facets', () => {
    const lockfile = parse(
      JSON.parse(
        `{"lockfileVersion":0.4,"facets":{"__proto__":${JSON.stringify(facet([rec('fs', FP_X)]))},"constructor":${JSON.stringify(facet([rec('fs', FP_X)]))}}}`,
      ),
    )
    const result = success(deriveLockedMcpInventory(lockfile))
    expect(result.servers[0]?.origins.map((o) => o.facet)).toEqual(['__proto__', 'constructor'])
  })

  test('mutating the input afterwards does not change the result', () => {
    const lockfile = parse({
      lockfileVersion: 0.4,
      facets: { a: facet([rec('fs', FP_X, { kind: 'aliased', as: 'project-fs' })]) },
    }) as {
      facets: Record<
        string,
        { source: { registry: string }; version: string; servers: { materialization: { as?: string } }[] }
      >
    }
    const result = deriveLockedMcpInventory(lockfile as unknown as SupportedLockfile)
    const snapshot = structuredClone(result)

    const entry = lockfile.facets.a
    if (entry === undefined) expect.unreachable()
    entry.source.registry = 'https://mutated.example'
    entry.version = '9.9.9'
    const server = entry.servers[0]
    if (server === undefined) expect.unreachable()
    server.materialization.as = 'mutated'
    entry.servers.push({ materialization: {} })

    expect(result).toEqual(snapshot)
  })

  test('results share no objects with the input or with each other', () => {
    const lockfile = parse({ lockfileVersion: 0.4, facets: { a: facet([rec('fs', FP_X)]) } })
    const entry = lockfile.facets.a
    if (entry === undefined || !('servers' in entry)) expect.unreachable()
    const result = success(deriveLockedMcpInventory(lockfile))
    const authored = result.authored[0]
    const origin = result.servers[0]?.origins[0]
    if (authored === undefined || origin === undefined) expect.unreachable()

    expect(authored.source).not.toBe(entry.source)
    expect(origin.source).not.toBe(entry.source)
    expect(origin.source).not.toBe(authored.source)
    expect(authored.materialization).not.toBe(entry.servers[0]?.materialization)
    expect(origin.materialization).not.toBe(authored.materialization)
  })

  test('opaque extensions never reach public output', () => {
    const lockfile = parse({
      lockfileVersion: 0.4,
      generatedBy: 'tool',
      facets: {
        a: {
          ...facet([{ ...rec('fs', FP_X), command: 'npx', env: { TOKEN: 'secret' } }]),
          source: { ...REGISTRY, mirror: 'https://mirror.example' },
          note: 'facet extension',
        },
      },
    })
    const result = success(deriveLockedMcpInventory(lockfile))
    const serialized = JSON.stringify(result)
    for (const leaked of ['mirror', 'note', 'command', 'npx', 'TOKEN', 'secret', 'generatedBy']) {
      expect(serialized).not.toContain(leaked)
    }
    expect(result.authored[0]?.source).toEqual(REGISTRY)
  })
})
