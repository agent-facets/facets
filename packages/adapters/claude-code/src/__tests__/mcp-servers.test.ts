import { describe, expect, test } from 'bun:test'
import type { McpServerCapability } from '@agent-facets/adapter'
import {
  type McpMatrixCaseId,
  type McpMatrixSeed,
  OBSOLETE_NAME,
  runMcpServerMatrix,
  UNOWNED_NAME,
} from '@agent-facets/adapter-test-kit'
import adapter from '../index.ts'
import { claudeCodeMcpServers } from '../mcp-servers.ts'

const DOCUMENT = '.mcp.json'

/** The canonical native rendering of the matrix's stdio server. */
const NATIVE_STDIO = '{ "type": "stdio", "command": "srv", "args": ["--root", "/w"], "env": { "TOKEN_NAME": "A" } }'

/** The same launch written the way a person would, leaning on Claude Code's defaults. */
const NATIVE_STDIO_IMPLICIT = '{ "command": "srv", "args": ["--root", "/w"], "env": { "TOKEN_NAME": "A" } }'

const _NATIVE_HTTP = '{ "type": "http", "url": "https://mcp.example.com/mcp" }'

const UNOWNED_ENTRY = '{ "command": "do-not-touch", "headersHelper": "print-secret" }'

function document(body: string): string {
  return `${body}\n`
}

function servers(entries: Record<string, string>): string {
  const members = Object.entries(entries)
    .map(([name, entry]) => `    "${name}": ${entry}`)
    .join(',\n')
  return document(`{\n  "mcpServers": {\n${members}\n  }\n}`)
}

const seeds = {
  'document-absent': { files: {} },

  'absent-untracked': { files: { [DOCUMENT]: servers({ [UNOWNED_NAME]: UNOWNED_ENTRY }) } },

  'absent-tracked': { files: { [DOCUMENT]: servers({}) } },

  'equivalent-tracked': { files: { [DOCUMENT]: servers({ fs: NATIVE_STDIO }) } },

  'equivalent-untracked': { files: { [DOCUMENT]: servers({ fs: NATIVE_STDIO }) } },

  // `type` omitted defaults to stdio, and an omitted `args`/`env` is the same
  // as an empty one — the desired declaration for this case supplies neither.
  'equivalent-normalized': { files: { [DOCUMENT]: servers({ fs: '{ "command": "srv", "args": [], "env": {} }' }) } },

  'equivalent-formatting-only': {
    files: { [DOCUMENT]: servers({ fs: NATIVE_STDIO_IMPLICIT }) },
    after: (project) => {
      // Nothing was written, so the hand-written spelling is still there.
      expect(project.read(DOCUMENT)).toBe(project.seeded(DOCUMENT))
    },
  },

  'divergent-tracked': { files: { [DOCUMENT]: servers({ fs: '{ "command": "stale" }' }) } },

  'divergent-untracked': { files: { [DOCUMENT]: servers({ fs: '{ "command": "stale" }' }) } },

  // Portable fields all match; `headers` decides how the connection
  // authenticates, which a credential-free declaration cannot vouch for.
  'divergent-unprovable': {
    files: {
      [DOCUMENT]: servers({
        fs: '{ "type": "stdio", "command": "srv", "args": ["--root", "/w"], "env": { "TOKEN_NAME": "A" }, "headers": { "X": "y" } }',
      }),
    },
    after: (project) => {
      const after = project.read(DOCUMENT) ?? ''
      expect(after).not.toContain('headers')
    },
  },

  'safe-extension-preserved': {
    files: { [DOCUMENT]: servers({ ext: '{ "command": "ext-server", "args": ["--old"], "timeout": 45000 }' }) },
    after: (project) => {
      const parsed = JSON.parse(project.read(DOCUMENT) ?? '{}')
      expect(parsed.mcpServers.ext).toEqual({
        type: 'stdio',
        command: 'ext-server',
        args: ['--new'],
        timeout: 45000,
      })
    },
  },

  'http-absent': { files: { [DOCUMENT]: servers({}) } },

  // `streamable-http` is Claude Code's own alias for the same transport.
  'http-equivalent': {
    files: { [DOCUMENT]: servers({ api: '{ "type": "streamable-http", "url": "https://mcp.example.com/mcp" }' }) },
  },

  'obsolete-owned-present': {
    files: { [DOCUMENT]: servers({ [OBSOLETE_NAME]: '{ "command": "gone" }', [UNOWNED_NAME]: UNOWNED_ENTRY }) },
    after: (project) => {
      const parsed = JSON.parse(project.read(DOCUMENT) ?? '{}')
      expect(parsed.mcpServers).not.toHaveProperty(OBSOLETE_NAME)
      expect(parsed.mcpServers[UNOWNED_NAME]).toEqual(JSON.parse(UNOWNED_ENTRY))
    },
  },

  'obsolete-owned-absent': { files: { [DOCUMENT]: servers({ [UNOWNED_NAME]: UNOWNED_ENTRY }) } },

  'unowned-entry-untouched': {
    files: { [DOCUMENT]: servers({ fs: NATIVE_STDIO, [UNOWNED_NAME]: UNOWNED_ENTRY }) },
    after: (project) => {
      expect(project.read(DOCUMENT)).toBe(project.seeded(DOCUMENT))
    },
  },

  'complete-batch': {
    files: {
      [DOCUMENT]: servers({
        fs: NATIVE_STDIO,
        api: '{ "type": "http", "url": "https://elsewhere.example.com/mcp" }',
        [OBSOLETE_NAME]: '{ "command": "gone" }',
        [UNOWNED_NAME]: UNOWNED_ENTRY,
      }),
    },
    after: (project) => {
      const parsed = JSON.parse(project.read(DOCUMENT) ?? '{}')
      expect(Object.keys(parsed.mcpServers).sort()).toEqual(['api', 'fs', UNOWNED_NAME].sort())
      expect(parsed.mcpServers.api).toEqual({ type: 'http', url: 'https://mcp.example.com/mcp' })
    },
  },

  'unrelated-settings-preserved': {
    files: { [DOCUMENT]: document('{\n  "$schema": "https://example.com/mcp.json",\n  "mcpServers": {}\n}') },
    after: (project) => {
      const parsed = JSON.parse(project.read(DOCUMENT) ?? '{}')
      expect(parsed.$schema).toBe('https://example.com/mcp.json')
    },
  },

  'nothing-desired-nothing-owned': { files: { [DOCUMENT]: servers({ [UNOWNED_NAME]: UNOWNED_ENTRY }) } },

  // A comment makes this a document Claude Code itself refuses to read, so
  // reporting it beats silently "repairing" a file the tool was ignoring.
  'malformed-document': { files: { [DOCUMENT]: document('{\n  // servers\n  "mcpServers": {}\n}') } },

  // An array would accept string keys in memory and lose them on serialization.
  'invalid-server-map': { files: { [DOCUMENT]: document('{ "mcpServers": [] }') } },
} satisfies Record<McpMatrixCaseId, McpMatrixSeed>

runMcpServerMatrix({ capability: claudeCodeMcpServers, seeds })

describe('claude-code MCP capability', () => {
  test('is declared on the adapter', () => {
    expect(adapter.mcpServers).toBe(claudeCodeMcpServers)
  })

  test('rejects a plan it did not produce', async () => {
    // The engine holds the plan as `unknown`, so this is the shape an untyped
    // caller can actually reach `apply` with.
    const asEngineSeesIt: McpServerCapability<unknown> = claudeCodeMcpServers
    await expect(asEngineSeesIt.apply({ plan: { kind: 'nonsense' } })).rejects.toThrow('did not produce')
  })
})
