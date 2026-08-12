import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerCapability } from '@agent-facets/adapter'
import {
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

/** The written JSONC document's server map, parsed rather than pattern-matched. */
function parsedServers(project: McpMatrixProject): Record<string, { command?: string[]; environment?: unknown }> {
  return JSON.parse((project.read(JSONC) ?? '{}').replaceAll(/^\s*\/\/.*$/gm, '')).mcp ?? {}
}

const seeds = {
  'document-absent': { files: {} },

  // The write path, asserted in full — see the claude-code seed for why this
  // one case carries it: the readers are covered everywhere, the writer only
  // here, and a dropped `environment` would otherwise go unnoticed.
  'absent-untracked': {
    files: { [JSONC]: document({ [UNOWNED_NAME]: UNOWNED_ENTRY }) },
    after: (project) => {
      expect(JSON.parse(project.read(JSONC) ?? '{}').mcp.fs).toEqual({
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
      const parsed = JSON.parse(project.read(JSONC) ?? '{}')
      expect(parsed.mcp.ext).toEqual({ type: 'local', command: ['ext-server', '--new'], timeout: 45000 })
    },
  },

  'http-absent': { files: { [JSONC]: document({}) } },

  'http-equivalent': { files: { [JSONC]: document({ api: NATIVE_HTTP }) } },

  'obsolete-owned-present': {
    files: {
      [JSONC]: document({ [OBSOLETE_NAME]: '{ "type": "local", "command": ["gone"] }', [UNOWNED_NAME]: UNOWNED_ENTRY }),
    },
    after: (project) => {
      const parsed = JSON.parse(project.read(JSONC) ?? '{}')
      expect(parsed.mcp).not.toHaveProperty(OBSOLETE_NAME)
      expect(parsed.mcp[UNOWNED_NAME]).toEqual(JSON.parse(UNOWNED_ENTRY))
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
      const parsed = JSON.parse(project.read(JSONC) ?? '{}')
      expect(Object.keys(parsed.mcp).sort()).toEqual(['api', 'fs', UNOWNED_NAME].sort())
      expect(parsed.mcp.api).toEqual({ type: 'remote', url: 'https://mcp.example.com/mcp' })
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
    const prepared = await openCodeMcpServers.prepare({
      projectRoot: root,
      desired: [STDIO_SERVER],
      previouslyOwnedNames,
    })
    if (!prepared.ok) expect.unreachable()
    const applied = await openCodeMcpServers.apply({ plan: prepared.preparation.plan })
    if (!applied.ok) expect.unreachable()
    return prepared.preparation.documentPaths
  }

  async function removeAll(previouslyOwnedNames: readonly string[]): Promise<void> {
    const prepared = await openCodeMcpServers.prepare({ projectRoot: root, desired: [], previouslyOwnedNames })
    if (!prepared.ok) expect.unreachable()
    const applied = await openCodeMcpServers.apply({ plan: prepared.preparation.plan })
    if (!applied.ok) expect.unreachable()
  }

  const read = (name: string): string => readFileSync(join(root, name), 'utf8')
  const servers = (name: string): Record<string, { command?: string[] }> =>
    JSON.parse(read(name).replaceAll(/^\s*\/\/.*$/gm, '')).mcp

  test('both documents are disclosed even when only one exists', async () => {
    writeFileSync(join(root, JSONC), '{ "mcp": {} }\n')

    const disclosed = await reconcile()

    // A path that does not exist is still a preimage the caller can restore
    // to, which is what makes creating the other layer recoverable.
    expect(disclosed).toEqual([join(root, JSONC), join(root, JSON_DOCUMENT)])
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
})

describe('opencode MCP capability', () => {
  test('is declared on the adapter', () => {
    expect(adapter.mcpServers).toBe(openCodeMcpServers)
  })

  test('refuses a declaration OpenCode would interpolate instead of using literally', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opencode-mcp-'))
    try {
      const prepared = await openCodeMcpServers.prepare({
        projectRoot: root,
        desired: [{ name: 'fs', declaration: { type: 'stdio', command: 'srv', env: { T: '{env:TOKEN}' } } }],
        previouslyOwnedNames: [],
      })
      if (prepared.ok) expect.unreachable()
      expect(prepared.failure.code).toBe('conflict')
      expect(prepared.failure.message).toContain('{env:TOKEN}')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects a plan it did not produce', async () => {
    // The engine holds the plan as `unknown`, so this is the shape an untyped
    // caller can actually reach `apply` with.
    const asEngineSeesIt: McpServerCapability<unknown> = openCodeMcpServers
    await expect(asEngineSeesIt.apply({ plan: { kind: 'nonsense' } })).rejects.toThrow('did not produce')
  })
})
