import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
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
import { parse as parseToml } from 'smol-toml'
import adapter from '../index.ts'
import { codexMcpServers } from '../mcp-servers.ts'

const DOCUMENT = '.codex/config.toml'

/** Codex has no transport tag: a `command` is stdio, a `url` is Streamable HTTP. */
const NATIVE_STDIO = `[mcp_servers.fs]
command = "srv"
args = ["--root", "/w"]
env = { TOKEN_NAME = "A" }
`

const NATIVE_HTTP = `[mcp_servers.api]
url = "https://mcp.example.com/mcp"
`

const UNOWNED_ENTRY = `[mcp_servers.${UNOWNED_NAME}]
command = "do-not-touch"
bearer_token_env_var = "SECRET"
`

const seeds = {
  'document-absent': { files: {} },

  // The write path, asserted in full — see the claude-code seed for why this
  // one case carries it. Asserted as literal text because TOML's env-table
  // notation is part of what the writer has to get right.
  'absent-untracked': {
    files: { [DOCUMENT]: UNOWNED_ENTRY },
    after: (project) => {
      const after = project.read(DOCUMENT) ?? ''
      expect(after).toContain('command = "srv"')
      expect(after).toMatch(/args = \[\s*"--root",\s*"\/w"\s*]/)
      expect(after).toContain('TOKEN_NAME = "A"')
    },
  },

  'absent-tracked': { files: { [DOCUMENT]: '[mcp_servers]\n' } },

  'equivalent-tracked': { files: { [DOCUMENT]: NATIVE_STDIO } },

  'equivalent-untracked': { files: { [DOCUMENT]: NATIVE_STDIO } },

  'equivalent-normalized': { files: { [DOCUMENT]: '[mcp_servers.fs]\ncommand = "srv"\nargs = []\nenv = {}\n' } },

  // Dotted keys, an inline table, and a quoted table name all denote the same
  // TOML value as the canonical spelling.
  'equivalent-formatting-only': {
    files: {
      [DOCUMENT]: `# hand-written
[mcp_servers."fs"]
env = { TOKEN_NAME = "A" }
args = [
  "--root",
  "/w",
]
command = "srv"
`,
    },
    after: (project) => {
      expect(project.read(DOCUMENT)).toBe(project.seeded(DOCUMENT))
    },
  },

  'divergent-tracked': { files: { [DOCUMENT]: '[mcp_servers.fs]\ncommand = "stale"\n' } },

  'divergent-untracked': { files: { [DOCUMENT]: '[mcp_servers.fs]\ncommand = "stale"\n' } },

  'divergent-argument-order': {
    files: {
      [DOCUMENT]: '[mcp_servers.fs]\ncommand = "srv"\nargs = ["/w", "--root"]\nenv = { TOKEN_NAME = "A" }\n',
    },
    after: (project) => {
      expect(project.read(DOCUMENT) ?? '').toContain('args = ["--root", "/w"]')
    },
  },

  'divergent-environment-value': {
    files: {
      [DOCUMENT]: '[mcp_servers.fs]\ncommand = "srv"\nargs = ["--root", "/w"]\nenv = { TOKEN_NAME = "B" }\n',
    },
    after: (project) => {
      expect(project.read(DOCUMENT) ?? '').toContain('TOKEN_NAME = "A"')
    },
  },

  // Portable fields match, but the entry names an environment variable to
  // authenticate with — a credential-free declaration cannot prove it equal.
  'divergent-unprovable': {
    files: {
      [DOCUMENT]: `${NATIVE_STDIO}bearer_token_env_var = "SECRET"\n`,
    },
    after: (project) => {
      expect(project.read(DOCUMENT) ?? '').not.toContain('bearer_token_env_var = "SECRET"\n[')
    },
  },

  'safe-extension-preserved': {
    files: {
      [DOCUMENT]: `[mcp_servers.ext]
command = "ext-server"
args = ["--old"]
startup_timeout_sec = 10.0
`,
    },
    after: (project) => {
      const after = project.read(DOCUMENT) ?? ''
      // The float notation matters: Codex deserializes this field as an f64,
      // and an integer `10` would be rejected.
      expect(after).toContain('startup_timeout_sec = 10.0')
      const parsed = parseToml(after) as { mcp_servers: Record<string, unknown> }
      expect(parsed.mcp_servers.ext).toEqual({ command: 'ext-server', args: ['--new'], startup_timeout_sec: 10 })
    },
  },

  'http-absent': { files: { [DOCUMENT]: '[mcp_servers]\n' } },

  'http-equivalent': { files: { [DOCUMENT]: NATIVE_HTTP } },

  'obsolete-owned-present': {
    files: { [DOCUMENT]: `[mcp_servers.${OBSOLETE_NAME}]\ncommand = "gone"\n\n${UNOWNED_ENTRY}` },
    after: (project) => {
      const parsed = parseToml(project.read(DOCUMENT) ?? '') as { mcp_servers: Record<string, unknown> }
      expect(parsed.mcp_servers).not.toHaveProperty(OBSOLETE_NAME)
      expect(parsed.mcp_servers[UNOWNED_NAME]).toEqual({ command: 'do-not-touch', bearer_token_env_var: 'SECRET' })
    },
  },

  'obsolete-owned-absent': { files: { [DOCUMENT]: UNOWNED_ENTRY } },

  'unowned-entry-untouched': {
    files: { [DOCUMENT]: `${NATIVE_STDIO}\n${UNOWNED_ENTRY}` },
    after: (project) => {
      expect(project.read(DOCUMENT)).toBe(project.seeded(DOCUMENT))
    },
  },

  'complete-batch': {
    files: {
      [DOCUMENT]: `${NATIVE_STDIO}
[mcp_servers.api]
url = "https://elsewhere.example.com/mcp"

[mcp_servers.${OBSOLETE_NAME}]
command = "gone"

${UNOWNED_ENTRY}`,
    },
    after: (project) => {
      const parsed = parseToml(project.read(DOCUMENT) ?? '') as { mcp_servers: Record<string, unknown> }
      expect(Object.keys(parsed.mcp_servers).sort()).toEqual(['api', 'fs', UNOWNED_NAME].sort())
      expect(parsed.mcp_servers.api).toEqual({ url: 'https://mcp.example.com/mcp' })
    },
  },

  'unrelated-settings-preserved': {
    files: {
      [DOCUMENT]: `# Codex configuration
model = "gpt-5.6"            # keep this trailing comment
project_doc_max_bytes = 32768
`,
    },
    after: (project) => {
      const after = project.read(DOCUMENT) ?? ''
      expect(after).toContain('# Codex configuration')
      expect(after).toContain('model = "gpt-5.6"            # keep this trailing comment')
      // An integer stays an integer: re-emitting `32768.0` would be just as
      // wrong as turning a float into an integer.
      expect(after).toContain('project_doc_max_bytes = 32768\n')
    },
  },

  'nothing-desired-nothing-owned': { files: { [DOCUMENT]: UNOWNED_ENTRY } },

  'malformed-document': { files: { [DOCUMENT]: 'not = [valid\n' } },

  'invalid-server-map': { files: { [DOCUMENT]: 'mcp_servers = "not a table"\n' } },
} satisfies Record<McpMatrixCaseId, McpMatrixSeed>

runMcpServerMatrix({ capability: codexMcpServers, seeds })

describe('codex config.toml editing', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codex-mcp-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /**
   * The comment-bearing round-trip proof. One tracked entry is updated; every
   * other byte of a hand-written config has to come back untouched — which a
   * parse-then-stringify TOML round trip cannot do.
   */
  test('updates one entry and leaves the rest of a hand-written config byte-for-byte', async () => {
    const configPath = join(root, DOCUMENT)
    const before = `# Codex config — hand-written
model = "gpt-5.6"            # keep this trailing comment
project_doc_max_bytes = 32768

[mcp_servers]

# Hand-configured; Facets must not touch this one.
[mcp_servers.manual]
command = "manual-server"
startup_timeout_sec = 12.5

[mcp_servers.docs]
command = "old-server"
startup_timeout_sec = 10.0   # native extension: must survive the update
`
    await Bun.write(configPath, before)

    const prepared = await codexMcpServers.prepare({
      projectRoot: root,
      desired: [{ name: 'docs', declaration: { type: 'stdio', command: 'docs-server', args: ['--port', '4000'] } }],
      previouslyOwnedNames: ['docs'],
    })
    if (!prepared.ok) expect.unreachable()
    const applied = await codexMcpServers.apply({ plan: prepared.preparation.plan })
    if (!applied.ok) expect.unreachable()
    expect(applied.status).toBe('changed')

    expect(readFileSync(configPath, 'utf8')).toBe(`# Codex config — hand-written
model = "gpt-5.6"            # keep this trailing comment
project_doc_max_bytes = 32768

[mcp_servers]

# Hand-configured; Facets must not touch this one.
[mcp_servers.manual]
command = "manual-server"
startup_timeout_sec = 12.5

[mcp_servers.docs]
command = "docs-server"
startup_timeout_sec = 10.0   # native extension: must survive the update
args = [ "--port", "4000" ]
`)
  })

  test('creates the .codex directory only when committing, never while planning', async () => {
    const prepared = await codexMcpServers.prepare({
      projectRoot: root,
      desired: [STDIO_SERVER],
      previouslyOwnedNames: [],
    })
    if (!prepared.ok) expect.unreachable()
    expect(existsSync(join(root, '.codex'))).toBe(false)

    const applied = await codexMcpServers.apply({ plan: prepared.preparation.plan })
    if (!applied.ok) expect.unreachable()
    expect(statSync(join(root, '.codex')).isDirectory()).toBe(true)
  })

  test('reports a document that changed after planning rather than overwriting it', async () => {
    const configPath = join(root, DOCUMENT)
    await Bun.write(configPath, '[mcp_servers]\n')

    const prepared = await codexMcpServers.prepare({
      projectRoot: root,
      desired: [STDIO_SERVER],
      previouslyOwnedNames: [],
    })
    if (!prepared.ok) expect.unreachable()

    await Bun.write(configPath, '[mcp_servers]\n# somebody else got here first\n')
    const applied = await codexMcpServers.apply({ plan: prepared.preparation.plan })

    if (applied.ok) expect.unreachable()
    if (applied.failure.code !== 'conflict') expect.unreachable()
    // Drift, not a format refusal: the document is fine, the run is stale.
    expect(applied.failure).toEqual({ code: 'conflict', reason: 'document-changed', path: configPath })
    expect(readFileSync(configPath, 'utf8')).toBe('[mcp_servers]\n# somebody else got here first\n')
  })
})

describe('codex MCP capability', () => {
  test('is declared on the adapter', () => {
    expect(adapter.mcpServers).toBe(codexMcpServers)
  })

  test('rejects a plan it did not produce', async () => {
    // The engine holds the plan as `unknown`, so this is the shape an untyped
    // caller can actually reach `apply` with.
    const asEngineSeesIt: McpServerCapability<unknown> = codexMcpServers
    await expect(asEngineSeesIt.apply({ plan: { kind: 'nonsense' } })).rejects.toThrow('did not produce')
  })
})
