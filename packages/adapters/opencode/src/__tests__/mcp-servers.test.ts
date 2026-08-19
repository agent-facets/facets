import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { McpServerContribution, PlanMcpServersResult } from '@agent-facets/adapter'
import { parseJsoncDocument, splitJsoncBom } from '@agent-facets/adapter-jsonc'
import {
  commitPlannedAction,
  type McpMatrixCaseId,
  type McpMatrixProject,
  type McpMatrixSeed,
  OBSOLETE_NAME,
  runMcpServerMatrix,
  STDIO_SERVER,
  UNOWNED_NAME,
} from '@agent-facets/adapter-test-kit'
import adapter from '../index.ts'
import { openCodeMcpServers } from '../mcp-servers.ts'

/**
 * The four project documents OpenCode merges, highest precedence first.
 *
 * OpenCode loads the project root's pair and then the `.opencode` pair over
 * it, and within a directory reads `.json` before `.jsonc`, so this is the
 * order in which a key defined more than once takes its value.
 */
const DOT_JSONC = '.opencode/opencode.jsonc'
const DOT_JSON = '.opencode/opencode.json'
const ROOT_JSONC = 'opencode.jsonc'
const ROOT_JSON = 'opencode.json'

const CANDIDATES = [DOT_JSONC, DOT_JSON, ROOT_JSONC, ROOT_JSON] as const

/** OpenCode fuses the executable and its arguments into one `command` array. */
const NATIVE_STDIO = '{ "type": "local", "command": ["srv", "--root", "/w"], "environment": { "TOKEN_NAME": "A" } }'

const NATIVE_HTTP = '{ "type": "remote", "url": "https://mcp.example.com/mcp" }'

const UNOWNED_ENTRY = '{ "type": "local", "command": ["do-not-touch"] }'

function document(entries: Record<string, string>): string {
  const members = Object.entries(entries)
    .map(([name, entry]) => `    "${name}": ${entry}`)
    .join(',\n')
  return `{\n  "mcp": {\n${members}\n  }\n}\n`
}

/** One entry as OpenCode's own loader would see it. */
type NativeEntry = Record<string, unknown>

/**
 * Read a document the way the adapter does.
 *
 * Through the shared parser rather than `JSON.parse` over a comment-stripping
 * regex: OpenCode reads both filenames as JSONC, so a seed may carry block
 * comments, a trailing comma, or a `//` inside a string value, and each of
 * those either survives the regex and breaks `JSON.parse` or is mangled by it.
 * A test reader that is stricter than the code under test fails for reasons
 * the product does not have.
 */
function parseDocument(text: string): Record<string, unknown> {
  const { body } = splitJsoncBom(text)
  const parsed = parseJsoncDocument(body)
  if (!parsed.ok) expect.unreachable()
  if (typeof parsed.value !== 'object' || parsed.value === null) expect.unreachable()
  return parsed.value as Record<string, unknown>
}

/** The document's server map, parsed rather than pattern-matched. */
function serverMap(text: string): Record<string, NativeEntry | undefined> {
  return (parseDocument(text).mcp ?? {}) as Record<string, NativeEntry | undefined>
}

/** The written JSONC document's server map. */
function parsedServers(project: McpMatrixProject): Record<string, NativeEntry | undefined> {
  return serverMap(project.read(DOT_JSONC) ?? '{}')
}

const seeds = {
  'document-absent': { files: {} },

  // The write path, asserted in full — see the claude-code seed for why this
  // one case carries it: the readers are covered everywhere, the writer only
  // here, and a dropped `environment` would otherwise go unnoticed.
  'absent-untracked': {
    files: { [DOT_JSONC]: document({ [UNOWNED_NAME]: UNOWNED_ENTRY }) },
    after: (project) => {
      expect(parsedServers(project).fs).toEqual({
        type: 'local',
        command: ['srv', '--root', '/w'],
        environment: { TOKEN_NAME: 'A' },
      })
    },
  },

  'absent-tracked': { files: { [DOT_JSONC]: document({}) } },

  'equivalent-tracked': { files: { [DOT_JSONC]: document({ fs: NATIVE_STDIO }) } },

  'equivalent-untracked': { files: { [DOT_JSONC]: document({ fs: NATIVE_STDIO }) } },

  'equivalent-normalized': {
    files: { [DOT_JSONC]: document({ fs: '{ "type": "local", "command": ["srv"], "environment": {} }' }) },
  },

  'equivalent-formatting-only': {
    files: {
      [DOT_JSONC]: `{
  // hand-written
  "mcp": {
    "fs": {
      "environment": { "TOKEN_NAME": "A" },
      "command": ["srv", "--root", "/w"],
      "type": "local", // members in a different order
    },
  }
}
`,
    },
    after: (project) => {
      expect(project.read(DOT_JSONC)).toBe(project.seeded(DOT_JSONC))
    },
  },

  'divergent-tracked': { files: { [DOT_JSONC]: document({ fs: '{ "type": "local", "command": ["stale"] }' }) } },

  'divergent-untracked': { files: { [DOT_JSONC]: document({ fs: '{ "type": "local", "command": ["stale"] }' }) } },

  // Same command and arguments, opposite order. OpenCode fuses them into one
  // array, so order is the only thing that differs.
  'divergent-argument-order': {
    files: {
      [DOT_JSONC]: document({
        fs: '{ "type": "local", "command": ["srv", "/w", "--root"], "environment": { "TOKEN_NAME": "A" } }',
      }),
    },
    after: (project) => {
      // Parsed and compared in full: the reversed seed already contains
      // `"srv"` and already lacks any one formatting-specific substring, so a
      // substring assertion passes without the writer having corrected
      // anything.
      expect(parsedServers(project).fs?.command).toEqual(['srv', '--root', '/w'])
    },
  },

  'divergent-environment-value': {
    files: {
      [DOT_JSONC]: document({
        fs: '{ "type": "local", "command": ["srv", "--root", "/w"], "environment": { "TOKEN_NAME": "B" } }',
      }),
    },
    after: (project) => {
      expect(parsedServers(project).fs?.environment).toEqual({ TOKEN_NAME: 'A' })
    },
  },

  // Portable fields match, but the server is switched off — precisely the
  // behavioral difference the project is asking to correct.
  'divergent-unprovable': {
    files: {
      [DOT_JSONC]: document({
        fs: '{ "type": "local", "command": ["srv", "--root", "/w"], "environment": { "TOKEN_NAME": "A" }, "enabled": false }',
      }),
    },
    after: (project) => {
      expect(project.read(DOT_JSONC) ?? '').not.toContain('"enabled": false')
    },
  },

  'safe-extension-preserved': {
    files: {
      [DOT_JSONC]: document({ ext: '{ "type": "local", "command": ["ext-server", "--old"], "timeout": 45000 }' }),
    },
    after: (project) => {
      expect(parsedServers(project).ext).toEqual({ type: 'local', command: ['ext-server', '--new'], timeout: 45000 })
    },
  },

  'http-absent': { files: { [DOT_JSONC]: document({}) } },

  'http-equivalent': { files: { [DOT_JSONC]: document({ api: NATIVE_HTTP }) } },

  'obsolete-owned-present': {
    files: {
      [DOT_JSONC]: document({
        [OBSOLETE_NAME]: '{ "type": "local", "command": ["gone"] }',
        [UNOWNED_NAME]: UNOWNED_ENTRY,
      }),
    },
    after: (project) => {
      const servers = parsedServers(project)
      expect(servers).not.toHaveProperty(OBSOLETE_NAME)
      expect(servers[UNOWNED_NAME]).toEqual(JSON.parse(UNOWNED_ENTRY))
    },
  },

  'obsolete-owned-absent': { files: { [DOT_JSONC]: document({ [UNOWNED_NAME]: UNOWNED_ENTRY }) } },

  'unowned-entry-untouched': {
    files: { [DOT_JSONC]: document({ fs: NATIVE_STDIO, [UNOWNED_NAME]: UNOWNED_ENTRY }) },
    after: (project) => {
      expect(project.read(DOT_JSONC)).toBe(project.seeded(DOT_JSONC))
    },
  },

  'complete-batch': {
    files: {
      [DOT_JSONC]: document({
        fs: NATIVE_STDIO,
        api: '{ "type": "remote", "url": "https://elsewhere.example.com/mcp" }',
        [OBSOLETE_NAME]: '{ "type": "local", "command": ["gone"] }',
        [UNOWNED_NAME]: UNOWNED_ENTRY,
      }),
    },
    after: (project) => {
      const servers = parsedServers(project)
      expect(Object.keys(servers).sort()).toEqual(['api', 'fs', UNOWNED_NAME].sort())
      expect(servers.api).toEqual({ type: 'remote', url: 'https://mcp.example.com/mcp' })
    },
  },

  'unrelated-settings-preserved': {
    files: {
      [DOT_JSONC]: `{
  // the model this project uses
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude",
  "mcp": {}
}
`,
    },
    after: (project) => {
      const after = project.read(DOT_JSONC) ?? ''
      expect(after).toContain('// the model this project uses')
      expect(after).toContain('"model": "anthropic/claude"')
      expect(after).toContain('"$schema": "https://opencode.ai/config.json"')
    },
  },

  'nothing-desired-nothing-owned': { files: { [DOT_JSONC]: document({ [UNOWNED_NAME]: UNOWNED_ENTRY }) } },

  'malformed-document': { files: { [DOT_JSONC]: '{ "mcp": { \n' } },

  'invalid-server-map': { files: { [DOT_JSONC]: '{ "mcp": [] }\n' } },
} satisfies Record<McpMatrixCaseId, McpMatrixSeed>

runMcpServerMatrix({ capability: openCodeMcpServers, seeds })

describe('opencode configuration layers', () => {
  let root: string

  beforeEach(() => {
    // `realpathSync` because macOS hands out `/var/...` temp paths that resolve
    // to `/private/var/...`, and the disclosed document paths are compared
    // against `join(root, …)` verbatim.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-mcp-')))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function seed(name: string, contents: string): void {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }

  async function plan(
    desired: readonly McpServerContribution[],
    previouslyOwnedNames: readonly string[],
  ): Promise<PlanMcpServersResult> {
    return await openCodeMcpServers.plan({ projectRoot: root, desired, previouslyOwnedNames })
  }

  /** Reconcile one desired stdio server, returning the paths actually written. */
  async function reconcile(previouslyOwnedNames: readonly string[] = []): Promise<readonly string[]> {
    const planned = await plan([STDIO_SERVER], previouslyOwnedNames)
    if (!planned.ok) expect.unreachable()
    commitPlannedAction(planned.plan.action)
    return planned.plan.action.kind === 'mutate' ? planned.plan.action.mutations.map((m) => m.path) : []
  }

  async function removeAll(previouslyOwnedNames: readonly string[]): Promise<void> {
    const planned = await plan([], previouslyOwnedNames)
    if (!planned.ok) expect.unreachable()
    commitPlannedAction(planned.plan.action)
  }

  const exists = (name: string): boolean => existsSync(join(root, name))
  const read = (name: string): string => readFileSync(join(root, name), 'utf8')
  const servers = (name: string): Record<string, NativeEntry | undefined> => serverMap(read(name))
  const candidatePaths = (): string[] => CANDIDATES.map((name) => join(root, name))

  describe('target selection', () => {
    /**
     * The three states a candidate document can be in, which is everything
     * target selection distinguishes.
     *
     * `bare` and `configured` are separate on purpose: a document that exists
     * without an `mcp` member is one this adapter would be introducing MCP
     * configuration into, while `"mcp": {}` is already where this project
     * keeps its servers.
     */
    const LAYER_STATES = ['absent', 'bare', 'configured'] as const
    type LayerState = (typeof LAYER_STATES)[number]

    const STATE_TEXT: Readonly<Record<Exclude<LayerState, 'absent'>, string>> = {
      bare: '{ "model": "anthropic/claude" }\n',
      configured: '{ "mcp": {} }\n',
    }

    /**
     * The rule, restated independently of the implementation: the
     * highest-precedence document with an `mcp` member, else the
     * highest-precedence one that exists, else the highest-precedence
     * candidate.
     */
    function expectedTarget(states: readonly LayerState[]): string {
      for (const preferred of ['configured', 'bare'] as const) {
        for (const [index, candidate] of CANDIDATES.entries()) {
          if (states[index] === preferred) return candidate
        }
      }
      return CANDIDATES[0]
    }

    /** Every state each candidate can be in, crossed with every other. */
    function everyCombination(): LayerState[][] {
      let combinations: LayerState[][] = [[]]
      for (const _candidate of CANDIDATES) {
        combinations = combinations.flatMap((prefix) => LAYER_STATES.map((state) => [...prefix, state]))
      }
      return combinations
    }

    const cases = everyCombination().map(
      (states) => [CANDIDATES.map((name, index) => `${name}=${states[index]}`).join(' '), states] as const,
    )

    test.each(cases)('%s', async (_label, states) => {
      for (const [index, candidate] of CANDIDATES.entries()) {
        const state = states[index]
        if (state !== undefined && state !== 'absent') seed(candidate, STATE_TEXT[state])
      }
      const before = new Map(CANDIDATES.filter(exists).map((name) => [name, read(name)]))

      const target = expectedTarget(states)
      const written = await reconcile()

      expect(written).toEqual([join(root, target)])
      expect(servers(target).fs?.command).toEqual(['srv', '--root', '/w'])
      // Every other candidate is left exactly as it was — including one that
      // did not exist, which must not be conjured beside the target.
      for (const candidate of CANDIDATES) {
        if (candidate === target) continue
        const previous = before.get(candidate)
        expect(exists(candidate)).toBe(previous !== undefined)
        if (previous !== undefined) expect(read(candidate)).toBe(previous)
      }
    })
  })

  test('a document is created in .opencode when no candidate exists', async () => {
    await reconcile()

    expect(servers(DOT_JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
    for (const candidate of [DOT_JSON, ROOT_JSONC, ROOT_JSON]) expect(exists(candidate)).toBe(false)
  })

  test('every candidate is disclosed, including ones that do not exist', async () => {
    seed(ROOT_JSON, '{ "mcp": {} }\n')

    const planned = await plan([STDIO_SERVER], [])
    if (!planned.ok) expect.unreachable()

    // Disclosure is how the caller establishes, before anything is approved,
    // that no two selected adapters reconcile one file — so it must name every
    // document the plan was computed from, in a fixed order.
    expect([...planned.plan.documentPaths]).toEqual(candidatePaths())
  })

  test('a plan that changes nothing still discloses every candidate', async () => {
    seed(DOT_JSONC, `{ "mcp": { "fs": ${NATIVE_STDIO} } }\n`)

    const planned = await plan([STDIO_SERVER], ['fs'])
    if (!planned.ok) expect.unreachable()

    expect(planned.plan.action.kind).toBe('unchanged')
    expect([...planned.plan.documentPaths]).toEqual(candidatePaths())
  })

  test('only the document that actually changes is planned', async () => {
    seed(DOT_JSONC, '{ "mcp": {} }\n')
    seed(ROOT_JSONC, '{ "mcp": {} }\n')

    const written = await reconcile()

    // A document nothing writes is not journaled: inspecting a file has never
    // been a reason to own it, and a rollback that rewrote it could overwrite
    // an edit this run never made.
    expect(written).toEqual([join(root, DOT_JSONC)])
  })

  test('a lower-precedence mcp member wins over a higher-precedence document without one', async () => {
    seed(DOT_JSONC, '{ "model": "anthropic/claude" }\n')
    seed(ROOT_JSON, '{ "mcp": {} }\n')

    await reconcile()

    // Where this project already keeps its servers, not merely the file that
    // sorts first.
    expect(servers(ROOT_JSON).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(read(DOT_JSONC)).toBe('{ "model": "anthropic/claude" }\n')
  })

  test('.opencode outranks the project root when both define servers', async () => {
    seed(DOT_JSON, '{ "mcp": {} }\n')
    seed(ROOT_JSONC, '{ "mcp": {} }\n')

    await reconcile()

    expect(servers(DOT_JSON).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(servers(ROOT_JSONC).fs).toBeUndefined()
  })

  test('jsonc outranks json inside .opencode', async () => {
    seed(DOT_JSONC, '{ "mcp": {} }\n')
    seed(DOT_JSON, '{ "mcp": {} }\n')

    await reconcile()

    expect(servers(DOT_JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(servers(DOT_JSON).fs).toBeUndefined()
  })

  test('the winning entry is classified from the merged view, not the target alone', async () => {
    // The target defines nothing under this name; a lower document defines it
    // equivalently. Classifying per-document would call this absent and write.
    seed(DOT_JSONC, '{ "mcp": {} }\n')
    seed(ROOT_JSON, `{ "mcp": { "fs": ${NATIVE_STDIO} } }\n`)

    const planned = await plan([STDIO_SERVER], ['fs'])
    if (!planned.ok) expect.unreachable()

    expect(planned.plan.outcomes).toEqual([{ kind: 'equivalent', name: 'fs', ownership: 'tracked' }])
    expect(planned.plan.action.kind).toBe('unchanged')
  })

  test('a shadowed copy of a desired entry is left where its author put it', async () => {
    seed(DOT_JSONC, '{ "mcp": {} }\n')
    const shadowed = '{ "mcp": { "fs": { "type": "local", "command": ["shadowed"] } } }\n'
    seed(ROOT_JSON, shadowed)

    const written = await reconcile(['fs'])

    // The lower copy is inert once the target defines the same key, and this
    // adapter did not put it there — so it is neither rewritten nor journaled.
    expect(written).toEqual([join(root, DOT_JSONC)])
    expect(servers(DOT_JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(read(ROOT_JSON)).toBe(shadowed)
  })

  test('an obsolete owned entry is removed from every document that defines it', async () => {
    // Removing only the winning copy would promote the shadowed one and leave
    // the server configured.
    seed(DOT_JSONC, '{ "mcp": { "fs": { "type": "local", "command": ["gone"] } } }\n')
    seed(DOT_JSON, '{ "mcp": { "fs": { "type": "local", "command": ["also-gone"] } } }\n')
    seed(ROOT_JSONC, '{ "mcp": { "fs": { "type": "local", "command": ["still-gone"] } } }\n')
    seed(ROOT_JSON, '{ "mcp": { "fs": { "type": "local", "command": ["gone-too"] } } }\n')

    await removeAll(['fs'])

    for (const candidate of CANDIDATES) expect(servers(candidate).fs).toBeUndefined()
  })

  test('an unowned entry survives in every document', async () => {
    const unowned = '{ "mcp": { "manual": { "type": "local", "command": ["keep"] } } }\n'
    seed(DOT_JSONC, '{ "mcp": {} }\n')
    seed(ROOT_JSONC, unowned)
    seed(ROOT_JSON, unowned)

    await reconcile()

    expect(read(ROOT_JSONC)).toBe(unowned)
    expect(read(ROOT_JSON)).toBe(unowned)
  })

  test('a malformed lower-precedence document fails the whole plan, read-only', async () => {
    // It is part of the configuration a change would land in, so planning past
    // it would be planning against a view OpenCode does not have.
    seed(DOT_JSONC, '{ "mcp": {} }\n')
    seed(ROOT_JSON, '{ "mcp": { \n')

    const planned = await plan([STDIO_SERVER], [])
    if (planned.ok) expect.unreachable()
    expect(planned.failure.code).toBe('parse-failed')
    if (planned.failure.code !== 'parse-failed') expect.unreachable()
    expect(planned.failure.path).toBe(join(root, ROOT_JSON))
    expect(read(DOT_JSONC)).toBe('{ "mcp": {} }\n')
  })

  test('a non-object mcp member in a lower-precedence document is reported against that document', async () => {
    seed(DOT_JSONC, '{ "mcp": {} }\n')
    seed(ROOT_JSONC, '{ "mcp": [] }\n')

    const planned = await plan([STDIO_SERVER], [])
    if (planned.ok) expect.unreachable()
    expect(planned.failure.code).toBe('validation-failed')
    if (planned.failure.code !== 'validation-failed') expect.unreachable()
    expect(planned.failure.path).toBe(join(root, ROOT_JSONC))
  })

  test('a byte-order mark on the target survives an edit', async () => {
    seed(DOT_JSONC, '\uFEFF{\n  "mcp": {}\n}\n')

    await reconcile()

    expect(read(DOT_JSONC).startsWith('\uFEFF')).toBe(true)
    expect(servers(DOT_JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
  })

  test('each document keeps its own byte-order mark through a multi-document change', async () => {
    // Removal writes several documents at once, which is where one shared flag
    // would put a mark on a file that never had one.
    seed(DOT_JSONC, '\uFEFF{ "mcp": { "fs": { "type": "local", "command": ["gone"] } } }\n')
    seed(ROOT_JSON, '{ "mcp": { "fs": { "type": "local", "command": ["shadowed"] } } }\n')

    await removeAll(['fs'])

    expect(read(DOT_JSONC).startsWith('\uFEFF')).toBe(true)
    expect(read(ROOT_JSON).startsWith('\uFEFF')).toBe(false)
    expect(servers(DOT_JSONC).fs).toBeUndefined()
    expect(servers(ROOT_JSON).fs).toBeUndefined()
  })

  test('a nested first indented line does not re-indent the edited member', async () => {
    seed(DOT_JSONC, '{\n  "tools": {\n        "deep": true\n  },\n  "mcp": {}\n}\n')

    await reconcile()

    // The `mcp` member keeps the two-space step it was written with rather
    // than being laid out with the eight-space run further down.
    expect(read(DOT_JSONC)).toContain('\n  "mcp": {')
  })
})

describe('opencode MCP capability', () => {
  test('is declared on the adapter', () => {
    expect(adapter.mcpServers).toBe(openCodeMcpServers)
  })

  test('refuses a declaration OpenCode would interpolate instead of using literally', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opencode-mcp-'))
    try {
      const prepared = await openCodeMcpServers.plan({
        projectRoot: root,
        desired: [{ name: 'fs', declaration: { type: 'stdio', command: 'srv', env: { T: '{env:TOKEN}' } } }],
        previouslyOwnedNames: [],
      })
      if (prepared.ok) expect.unreachable()
      if (prepared.failure.code !== 'conflict') expect.unreachable()
      if (prepared.failure.reason !== 'interpolation') expect.unreachable()
      // No document is named: the guard runs before a write target is chosen,
      // and this failure used to be attributed to one particular layer whether
      // or not that file was the one a write would have touched.
      expect(prepared.failure).toEqual({
        code: 'conflict',
        reason: 'interpolation',
        serverName: 'fs',
        value: '{env:TOKEN}',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
