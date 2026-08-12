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
  UNOWNED_NAME,
} from '@agent-facets/adapter-test-kit'
import adapter from '../index.ts'
import { claudeCodeMcpServers } from '../mcp-servers.ts'

const DOCUMENT = '.mcp.json'

/**
 * Claude Code's own interpolation syntax, assembled rather than written out so
 * this file does not itself contain the placeholder it is testing for.
 */
function interpolated(name: string): string {
  return `${'$'}{${name}}`
}

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

  // The write path, asserted in full. Every other case compares an entry the
  // seed already contains, which exercises the reader; only a case that
  // creates one proves the writer renders the whole declaration -- `env`
  // included, which nothing else here would notice going missing.
  'absent-untracked': {
    files: { [DOCUMENT]: servers({ [UNOWNED_NAME]: UNOWNED_ENTRY }) },
    after: (project) => {
      expect(JSON.parse(project.read(DOCUMENT) ?? '{}').mcpServers.fs).toEqual({
        type: 'stdio',
        command: 'srv',
        args: ['--root', '/w'],
        env: { TOKEN_NAME: 'A' },
      })
    },
  },

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

  // Same command, same arguments, opposite order.
  'divergent-argument-order': {
    files: {
      [DOCUMENT]: servers({
        fs: '{ "type": "stdio", "command": "srv", "args": ["/w", "--root"], "env": { "TOKEN_NAME": "A" } }',
      }),
    },
    after: (project) => {
      expect(JSON.parse(project.read(DOCUMENT) ?? '{}').mcpServers.fs.args).toEqual(['--root', '/w'])
    },
  },

  // Same env key, different value.
  'divergent-environment-value': {
    files: {
      [DOCUMENT]: servers({
        fs: '{ "type": "stdio", "command": "srv", "args": ["--root", "/w"], "env": { "TOKEN_NAME": "B" } }',
      }),
    },
    after: (project) => {
      expect(JSON.parse(project.read(DOCUMENT) ?? '{}').mcpServers.fs.env).toEqual({ TOKEN_NAME: 'A' })
    },
  },

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

  describe('native document edits', () => {
    // Created and removed around each test rather than deleted at the end of
    // one: a failing assertion used to skip the cleanup and leak the directory
    // for exactly the runs where something already went wrong.
    let root: string

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'claude-mcp-'))
    })

    afterEach(() => {
      rmSync(root, { recursive: true, force: true })
    })

    test('a one-entry change leaves unrelated formatting byte-identical', async () => {
      // Reserializing the document would reflow all of this even while preserving
      // indentation and line endings, which is exactly what the syntax-aware edit
      // exists to avoid.
      const before = [
        '{',
        '  "$schema": "https://example.com/mcp.json",',
        '',
        '  "permissions": { "allow": ["Bash(ls:*)"], "deny": [] },',
        '',
        '  "mcpServers": {',
        '    "manual": { "command": "do-not-touch", "args": ["a", "b"] }',
        '  }',
        '}',
        '',
      ].join('\n')
      writeFileSync(join(root, DOCUMENT), before)

      const prepared = await claudeCodeMcpServers.prepare({
        projectRoot: root,
        desired: [{ name: 'fs', declaration: { type: 'stdio', command: 'srv' } }],
        previouslyOwnedNames: [],
      })
      if (!prepared.ok) expect.unreachable()
      const applied = await claudeCodeMcpServers.apply({ plan: prepared.preparation.plan })
      expect(applied.ok).toBe(true)

      const after = readFileSync(join(root, DOCUMENT), 'utf8')
      // Everything outside the edited property keeps its exact layout: the
      // compact inline object, the blank-line grouping, and the member order. A
      // full reserialization would have flattened all three.
      expect(after).toContain('"permissions": { "allow": ["Bash(ls:*)"], "deny": [] }')
      expect(after).toContain('\n\n  "permissions"')
      expect(after).toContain('"$schema": "https://example.com/mcp.json",\n')
      // The unowned entry keeps its meaning; only the entry being written moves.
      expect(JSON.parse(after).mcpServers.manual).toEqual({ command: 'do-not-touch', args: ['a', 'b'] })
      expect(JSON.parse(after).mcpServers.fs).toEqual({ type: 'stdio', command: 'srv' })
    })

    test('a byte-order mark survives an edit', async () => {
      writeFileSync(join(root, DOCUMENT), '\uFEFF{\n  "mcpServers": {}\n}\n')

      const prepared = await claudeCodeMcpServers.prepare({
        projectRoot: root,
        desired: [{ name: 'fs', declaration: { type: 'stdio', command: 'srv' } }],
        previouslyOwnedNames: [],
      })
      if (!prepared.ok) expect.unreachable()
      await claudeCodeMcpServers.apply({ plan: prepared.preparation.plan })

      const after = readFileSync(join(root, DOCUMENT), 'utf8')
      expect(after.charCodeAt(0)).toBe(0xfeff)
      expect(JSON.parse(after.slice(1)).mcpServers.fs.command).toBe('srv')
    })
  })

  test('every interpolated position is rejected, naming the offending value', async () => {
    // The offending value is asserted per position rather than in a separate
    // test of one position: the value is what makes the failure actionable,
    // and checking it only for `env` left the other three proving nothing but
    // a failure code.
    const cases = [
      { declaration: { type: 'stdio', command: interpolated('BIN') }, offender: interpolated('BIN') },
      {
        declaration: { type: 'stdio', command: 'srv', args: [interpolated('FLAG')] },
        offender: interpolated('FLAG'),
      },
      {
        declaration: { type: 'stdio', command: 'srv', env: { TOKEN: interpolated('SECRET') } },
        offender: interpolated('SECRET'),
      },
      {
        declaration: { type: 'http', url: `https://${interpolated('HOST')}.example.com/mcp` },
        offender: `https://${interpolated('HOST')}.example.com/mcp`,
      },
    ] as const

    for (const { declaration, offender } of cases) {
      const result = await claudeCodeMcpServers.prepare({
        projectRoot: '/does-not-need-to-exist',
        desired: [{ name: 'fs', declaration }],
        previouslyOwnedNames: [],
      })
      if (result.ok) expect.unreachable()
      if (result.failure.code !== 'conflict') expect.unreachable()
      if (result.failure.reason !== 'interpolation') expect.unreachable()
      expect(result.failure.serverName).toBe('fs')
      expect(result.failure.value).toBe(offender)
    }
  })

  test('rejects a plan it did not produce', async () => {
    // The engine holds the plan as `unknown`, so this is the shape an untyped
    // caller can actually reach `apply` with.
    const asEngineSeesIt: McpServerCapability<unknown> = claudeCodeMcpServers
    await expect(asEngineSeesIt.apply({ plan: { kind: 'nonsense' } })).rejects.toThrow('did not produce')
  })
})
