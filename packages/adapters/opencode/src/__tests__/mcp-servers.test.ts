import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerCapability } from '@agent-facets/adapter'
import {
  type McpMatrixCaseId,
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

const seeds = {
  'document-absent': { files: {} },

  'absent-untracked': { files: { [JSONC]: document({ [UNOWNED_NAME]: UNOWNED_ENTRY }) } },

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

describe('opencode document selection', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'opencode-mcp-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function reconcile(): Promise<readonly string[]> {
    const prepared = await openCodeMcpServers.prepare({
      projectRoot: root,
      desired: [STDIO_SERVER],
      previouslyOwnedNames: [],
    })
    if (!prepared.ok) expect.unreachable()
    const applied = await openCodeMcpServers.apply({ plan: prepared.preparation.plan })
    if (!applied.ok) expect.unreachable()
    return prepared.preparation.documentPaths
  }

  test('reconciles the JSONC document and leaves the JSON one alone when both exist', async () => {
    writeFileSync(join(root, JSONC), '{ "mcp": {} }\n')
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": { "fs": { "type": "local", "command": ["other"] } } }\n')

    const disclosed = await reconcile()

    expect(disclosed).toEqual([join(root, JSONC)])
    expect(readFileSync(join(root, JSONC), 'utf8')).toContain('"srv"')
    expect(readFileSync(join(root, JSON_DOCUMENT), 'utf8')).toBe(
      '{ "mcp": { "fs": { "type": "local", "command": ["other"] } } }\n',
    )
  })

  test('reconciles an existing JSON document rather than creating a JSONC one beside it', async () => {
    writeFileSync(join(root, JSON_DOCUMENT), '{ "mcp": {} }\n')

    const disclosed = await reconcile()

    expect(disclosed).toEqual([join(root, JSON_DOCUMENT)])
    expect(readFileSync(join(root, JSON_DOCUMENT), 'utf8')).toContain('"srv"')
    expect(() => readFileSync(join(root, JSONC), 'utf8')).toThrow()
  })

  test('creates a JSONC document when neither exists', async () => {
    const disclosed = await reconcile()

    expect(disclosed).toEqual([join(root, JSONC)])
    expect(readFileSync(join(root, JSONC), 'utf8')).toContain('"srv"')
    expect(() => readFileSync(join(root, JSON_DOCUMENT), 'utf8')).toThrow()
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
