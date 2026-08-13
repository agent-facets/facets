import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const JSONC = 'opencode.jsonc'
const JSON_DOCUMENT = 'opencode.json'

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
  return serverMap(project.read(JSONC) ?? '{}')
}

const seeds = {
  'document-absent': { files: {} },

  // The write path, asserted in full — see the claude-code seed for why this
  // one case carries it: the readers are covered everywhere, the writer only
  // here, and a dropped `environment` would otherwise go unnoticed.
  'absent-untracked': {
    files: { [JSONC]: document({ [UNOWNED_NAME]: UNOWNED_ENTRY }) },
    after: (project) => {
      expect(parsedServers(project).fs).toEqual({
        type: 'local',
        command: ['srv', '--root', '/w'],
        environment: { TOKEN_NAME: 'A' },
      })
    },
  },

  'absent-tracked': { files: { [JSONC]: document({}) } },

  'equivalent-tracked': { files: { [JSONC]: document({ fs: NATIVE_STDIO }) } },

  'equivalent-untracked': { files: { [JSONC]: document({ fs: NATIVE_STDIO }) } },

  'equivalent-normalized': {
    files: { [JSONC]: document({ fs: '{ "type": "local", "command": ["srv"], "environment": {} }' }) },
  },

  'equivalent-formatting-only': {
    files: {
      [JSONC]: `{
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
      expect(project.read(JSONC)).toBe(project.seeded(JSONC))
    },
  },

  'divergent-tracked': { files: { [JSONC]: document({ fs: '{ "type": "local", "command": ["stale"] }' }) } },

  'divergent-untracked': { files: { [JSONC]: document({ fs: '{ "type": "local", "command": ["stale"] }' }) } },

  // Same command and arguments, opposite order. OpenCode fuses them into one
  // array, so order is the only thing that differs.
  'divergent-argument-order': {
    files: {
      [JSONC]: document({
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
      [JSONC]: document({
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
      [JSONC]: document({
        fs: '{ "type": "local", "command": ["srv", "--root", "/w"], "environment": { "TOKEN_NAME": "A" }, "enabled": false }',
      }),
    },
    after: (project) => {
      expect(project.read(JSONC) ?? '').not.toContain('"enabled": false')
    },
  },

  'safe-extension-preserved': {
    files: {
      [JSONC]: document({ ext: '{ "type": "local", "command": ["ext-server", "--old"], "timeout": 45000 }' }),
    },
    after: (project) => {
      expect(parsedServers(project).ext).toEqual({ type: 'local', command: ['ext-server', '--new'], timeout: 45000 })
    },
  },

  'http-absent': { files: { [JSONC]: document({}) } },

  'http-equivalent': { files: { [JSONC]: document({ api: NATIVE_HTTP }) } },

  'obsolete-owned-present': {
    files: {
      [JSONC]: document({ [OBSOLETE_NAME]: '{ "type": "local", "command": ["gone"] }', [UNOWNED_NAME]: UNOWNED_ENTRY }),
    },
    after: (project) => {
      const servers = parsedServers(project)
      expect(servers).not.toHaveProperty(OBSOLETE_NAME)
      expect(servers[UNOWNED_NAME]).toEqual(JSON.parse(UNOWNED_ENTRY))
    },
  },

  'obsolete-owned-absent': { files: { [JSONC]: document({ [UNOWNED_NAME]: UNOWNED_ENTRY }) } },

  'unowned-entry-untouched': {
    files: { [JSONC]: document({ fs: NATIVE_STDIO, [UNOWNED_NAME]: UNOWNED_ENTRY }) },
    after: (project) => {
      expect(project.read(JSONC)).toBe(project.seeded(JSONC))
    },
  },

  'complete-batch': {
    files: {
      [JSONC]: document({
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
      [JSONC]: `{
  // the model this project uses
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude",
  "mcp": {}
}
`,
    },
    after: (project) => {
      const after = project.read(JSONC) ?? ''
      expect(after).toContain('// the model this project uses')
      expect(after).toContain('"model": "anthropic/claude"')
      expect(after).toContain('"$schema": "https://opencode.ai/config.json"')
    },
  },

  'nothing-desired-nothing-owned': { files: { [JSONC]: document({ [UNOWNED_NAME]: UNOWNED_ENTRY }) } },

  'malformed-document': { files: { [JSONC]: '{ "mcp": { \n' } },

  'invalid-server-map': { files: { [JSONC]: '{ "mcp": [] }\n' } },
} satisfies Record<McpMatrixCaseId, McpMatrixSeed>

runMcpServerMatrix({ capability: openCodeMcpServers, seeds })

describe('opencode configuration layers', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'opencode-mcp-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function reconcile(previouslyOwnedNames: readonly string[] = []): Promise<readonly string[]> {
    const planned = await openCodeMcpServers.plan({
      projectRoot: root,
      desired: [STDIO_SERVER],
      previouslyOwnedNames,
    })
    if (!planned.ok) expect.unreachable()
    commitPlannedAction(planned.plan.action)
    return planned.plan.action.kind === 'mutate' ? planned.plan.action.mutations.map((m) => m.path) : []
  }

  async function removeAll(previouslyOwnedNames: readonly string[]): Promise<void> {
    const planned = await openCodeMcpServers.plan({ projectRoot: root, desired: [], previouslyOwnedNames })
    if (!planned.ok) expect.unreachable()
    commitPlannedAction(planned.plan.action)
  }

  const read = (name: string): string => readFileSync(join(root, name), 'utf8')
  const servers = (name: string): Record<string, NativeEntry | undefined> => serverMap(read(name))

  test('only the layer that actually changes is planned', async () => {
    writeFileSync(join(root, JSONC), '{ "mcp": {} }\n')

    const mutated = await reconcile()

    // The layer nothing writes is not journaled: inspecting a document has
    // never been a reason to own it, and a rollback that rewrote it could
    // overwrite an edit this run never made.
    expect(mutated).toEqual([join(root, JSONC)])
  })

  test('a new entry prefers the JSONC layer when both exist', async () => {
    writeFileSync(join(root, JSONC), '{ "mcp": {} }\n')
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": {} }\n')

    await reconcile()

    expect(servers(JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(servers(JSON_DOCUMENT).fs).toBeUndefined()
  })

  test('an entry defined only in the JSON layer is updated there', async () => {
    // That layer is where the key currently wins, so writing the JSONC file
    // instead would leave the merged configuration unchanged.
    writeFileSync(join(root, JSONC), '{ "mcp": {} }\n')
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": { "fs": { "type": "local", "command": ["other"] } } }\n')

    await reconcile(['fs'])

    expect(servers(JSON_DOCUMENT).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(servers(JSONC).fs).toBeUndefined()
  })

  test('an owned entry defined in both layers is collapsed into the JSONC one', async () => {
    writeFileSync(join(root, JSONC), '{ "mcp": { "fs": { "type": "local", "command": ["stale"] } } }\n')
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": { "fs": { "type": "local", "command": ["shadowed"] } } }\n')

    await reconcile(['fs'])

    expect(servers(JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(servers(JSON_DOCUMENT).fs).toBeUndefined()
  })

  test('an obsolete owned entry is removed from the lower layer', async () => {
    writeFileSync(join(root, JSONC), '{ "mcp": {} }\n')
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": { "fs": { "type": "local", "command": ["gone"] } } }\n')

    await removeAll(['fs'])

    expect(servers(JSON_DOCUMENT).fs).toBeUndefined()
  })

  test('an unowned entry survives in either layer', async () => {
    writeFileSync(join(root, JSONC), '{ "mcp": {} }\n')
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": { "manual": { "type": "local", "command": ["keep"] } } }\n')

    await reconcile()

    expect(servers(JSON_DOCUMENT).manual?.command).toEqual(['keep'])
  })

  test('an existing JSON layer is used rather than creating a JSONC one beside it', async () => {
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": {} }\n')

    await reconcile()

    expect(servers(JSON_DOCUMENT).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(() => read(JSONC)).toThrow()
  })

  test('a JSONC document is created when neither layer exists', async () => {
    await reconcile()

    expect(servers(JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(() => read(JSON_DOCUMENT)).toThrow()
  })

  test('a byte-order mark on the JSONC layer survives an edit', async () => {
    writeFileSync(join(root, JSONC), '\uFEFF{\n  "mcp": {}\n}\n')

    await reconcile()

    expect(read(JSONC).startsWith('\uFEFF')).toBe(true)
    expect(servers(JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
  })

  test('a byte-order mark on the JSON layer survives an edit', async () => {
    writeFileSync(join(root, JSON_DOCUMENT), '\uFEFF{\n  "mcp": {}\n}\n')

    await reconcile()

    expect(read(JSON_DOCUMENT).startsWith('\uFEFF')).toBe(true)
    expect(servers(JSON_DOCUMENT).fs?.command).toEqual(['srv', '--root', '/w'])
  })

  test('each layer keeps its own byte-order mark through a two-document change', async () => {
    // The collapse path writes both layers at once, which is where one shared
    // flag would put a mark on the file that never had one.
    writeFileSync(join(root, JSONC), '\uFEFF{ "mcp": { "fs": { "type": "local", "command": ["stale"] } } }\n')
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": { "fs": { "type": "local", "command": ["shadowed"] } } }\n')

    await reconcile(['fs'])

    expect(read(JSONC).startsWith('\uFEFF')).toBe(true)
    expect(read(JSON_DOCUMENT).startsWith('\uFEFF')).toBe(false)
    expect(servers(JSONC).fs?.command).toEqual(['srv', '--root', '/w'])
    expect(servers(JSON_DOCUMENT).fs).toBeUndefined()
  })

  test('a nested first indented line does not re-indent the edited member', async () => {
    writeFileSync(join(root, JSONC), '{\n  "tools": {\n        "deep": true\n  },\n  "mcp": {}\n}\n')

    await reconcile()

    // The `mcp` member keeps the two-space step it was written with rather
    // than being laid out with the eight-space run further down.
    expect(read(JSONC)).toContain('\n  "mcp": {')
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
      // and this failure used to be attributed to the JSONC layer whether or
      // not that file was the one a write would have touched.
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
