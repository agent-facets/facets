import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type ApplyMcpServersResult,
  applyMcpTextPlan,
  errorMessage,
  isPlainObject,
  type McpNativeMatch,
  type McpServerCapability,
  type McpServerContribution,
  type McpTextPlan,
  type PrepareMcpServersRequest,
  type PrepareMcpServersResult,
  prepareMcpTextPlan,
  type ReadonlyMcpServerDeclaration,
  readTextOrAbsent,
  sameStringArray,
  sameStringRecord,
} from '@agent-facets/adapter'
import { parseDocument, TomlFormat } from '@decimalturn/toml-patch'

/**
 * Codex MCP server reconciliation.
 *
 * ## The document
 *
 * Codex reads project-scoped settings from `<projectRoot>/.codex/config.toml`
 * and merges them over the user-level `~/.codex/config.toml`. Both files use
 * the same name and the same `mcp_servers` table, which makes writing to the
 * wrong one an easy and expensive mistake; this capability only ever touches
 * the project file.
 *
 * Codex loads project layers only for a *trusted* project, and trust is
 * recorded in the user-level config this adapter is forbidden to write. A
 * correct project file is therefore still the right output for an untrusted
 * project — it simply stays inert until the user trusts the directory in Codex.
 *
 * ## Why a CST editor rather than the TOML serializer already in this package
 *
 * `smol-toml` (used elsewhere here for Facets-owned agent files, which are
 * generated whole) is a value-model library: `stringify(parse(text))` discards
 * every comment and re-renders every value. On a shared config that is
 * destructive twice over — Codex's own sample config is mostly comments, and
 * `stringify` re-emits the TOML float `10.0` as the integer `10`, which
 * Codex's deserializer then rejects for an `f64` field.
 *
 * `@decimalturn/toml-patch` diffs against a concrete syntax tree and edits only
 * the values that actually changed, so untouched entries — comments, spacing,
 * table order, and float notation included — survive byte-for-byte.
 */

/** The project document, relative to the project root. */
const DOCUMENT_PATH = ['.codex', 'config.toml'] as const

/** The table Codex reads servers from. */
const SERVER_MAP_KEY = 'mcp_servers'

/**
 * Members of a native entry outside the portable model that do not change how
 * the server is launched or connected to, so they survive an update to an entry
 * the project already owns: startup and tool timeouts, and the settings that
 * decide which tools Codex surfaces and how it asks about them.
 *
 * Deliberately excluded: `cwd` and `env_vars` (what the process inherits and
 * where it starts), `experimental_environment` (whether it runs locally at
 * all), and everything authentication-shaped — `http_headers`,
 * `env_http_headers`, `bearer_token_env_var`, `auth`, `oauth`, `oauth_resource`,
 * `scopes`. A portable declaration carries no credentials, so an entry holding
 * one cannot be proven equivalent to it.
 */
const SAFE_EXTENSION_KEYS: ReadonlySet<string> = new Set([
  'startup_timeout_sec',
  'startup_timeout_ms',
  'tool_timeout_sec',
  'supports_parallel_tool_calls',
  'required',
  'enabled_tools',
  'disabled_tools',
  'default_tools_approval_mode',
  'tools',
])

/** Members this adapter renders from the declaration, per transport. */
const PORTABLE_KEYS: Readonly<Record<'stdio' | 'http', ReadonlySet<string>>> = {
  stdio: new Set(['command', 'args', 'env']),
  http: new Set(['url']),
}

/**
 * Where `mcp_servers.<name>.<member>` stops being rendered as its own `[table]`
 * header and becomes an inline table.
 *
 * `2` puts `[mcp_servers.<name>]` on its own header — Codex's documented shape —
 * while an entry's `env` renders as `env = { KEY = "value" }`, which is how
 * Codex's own reference config writes it.
 */
const INLINE_TABLE_DEPTH = 2

export const codexMcpServers: McpServerCapability<McpTextPlan> = {
  async prepare(request: PrepareMcpServersRequest): Promise<PrepareMcpServersResult<McpTextPlan>> {
    const path = join(request.projectRoot, ...DOCUMENT_PATH)

    const read = await readTextOrAbsent(path)
    if (!read.ok) return { ok: false, failure: read.failure }
    const text = read.text

    let document: ReturnType<typeof parseDocument> | null = null
    let root: Record<string, unknown> = {}
    if (text !== null) {
      try {
        document = parseDocument(text)
        // `toJsObject` is typed `any` by the library; narrowing it here is the
        // only place that looseness is allowed to exist.
        const parsed: unknown = document.toJsObject
        if (!isPlainObject(parsed)) {
          return {
            ok: false,
            failure: { code: 'validation-failed', path, message: 'document root must be a TOML table' },
          }
        }
        root = parsed
      } catch (err) {
        return { ok: false, failure: { code: 'parse-failed', path, message: errorMessage(err) } }
      }
    }

    const rawServers = root[SERVER_MAP_KEY]
    if (rawServers !== undefined && !isPlainObject(rawServers)) {
      return {
        ok: false,
        failure: { code: 'validation-failed', path, message: `"${SERVER_MAP_KEY}" must be a table of server entries` },
      }
    }
    const servers: Record<string, unknown> = rawServers ?? {}
    const tracked = new Set(request.previouslyOwnedNames)
    const desiredByName = new Map(request.desired.map((contribution) => [contribution.name, contribution]))

    return prepareMcpTextPlan({
      request,
      documentPaths: [path],
      presentNames: new Set(Object.keys(servers)),
      compare: (contribution) => compareEntry(servers[contribution.name], contribution.declaration),
      buildEdits: (outcomes) => {
        for (const outcome of outcomes) {
          switch (outcome.kind) {
            case 'equivalent':
              break
            case 'absent':
            case 'divergent': {
              const contribution = desiredByName.get(outcome.name) as McpServerContribution
              const preserved =
                outcome.kind === 'divergent' && tracked.has(outcome.name)
                  ? preservableExtensions(servers[outcome.name], contribution.declaration)
                  : {}
              servers[outcome.name] = renderEntry(contribution.declaration, preserved)
              break
            }
            case 'obsolete-owned':
              delete servers[outcome.name]
              break
          }
        }
        root[SERVER_MAP_KEY] = servers

        try {
          const format = text === null ? TomlFormat.default() : TomlFormat.autoDetectFormat(text)
          format.inlineTableStart = INLINE_TABLE_DEPTH
          const target = document ?? parseDocument('')
          target.patch(root, format)
          return { ok: true, edits: [{ path, expected: text, contents: target.toTomlString }] }
        } catch (err) {
          return { ok: false, failure: { code: 'conflict', path, message: errorMessage(err) } }
        }
      },
    })
  },

  async apply(request: { readonly plan: unknown }): Promise<ApplyMcpServersResult> {
    return applyMcpTextPlan(request.plan, {
      adapterName: 'codex',
      // The atomic write puts its temporary file beside the target, so the
      // `.codex` directory has to exist before the rename can be same-volume.
      beforeWrite: async (path) => {
        await mkdir(dirname(path), { recursive: true })
      },
    })
  },
}

/**
 * Compare an existing native entry with the rendering of a desired
 * declaration.
 *
 * Codex has no transport tag: an entry is stdio because it has a `command` and
 * Streamable HTTP because it has a `url`. An entry with both, or neither, is a
 * shape this adapter cannot classify, so it fails closed.
 */
function compareEntry(existing: unknown, declaration: ReadonlyMcpServerDeclaration): McpNativeMatch {
  if (!isPlainObject(existing)) return 'divergent'
  if (nativeTransport(existing) !== declaration.type) return 'divergent'

  if (declaration.type === 'stdio') {
    if (existing.command !== declaration.command) return 'divergent'
    if (!sameStringArray(existing.args, declaration.args ?? [])) return 'divergent'
    if (!sameStringRecord(existing.env, declaration.env ?? {})) return 'divergent'
  } else if (existing.url !== declaration.url) {
    return 'divergent'
  }

  const portable = PORTABLE_KEYS[declaration.type]
  for (const [key, value] of Object.entries(existing)) {
    if (portable.has(key)) continue
    if (!isSafeExtension(key, value)) return 'divergent'
  }

  return 'equivalent'
}

/**
 * `enabled` is safe only when it is `true`; `enabled = false` means the server
 * the project asked for would not start, which is a behavioral difference.
 */
function isSafeExtension(key: string, value: unknown): boolean {
  if (key === 'enabled') return value === true
  return SAFE_EXTENSION_KEYS.has(key)
}

function nativeTransport(existing: Record<string, unknown>): 'stdio' | 'http' | 'unknown' {
  const hasCommand = typeof existing.command === 'string'
  const hasUrl = typeof existing.url === 'string'
  if (hasCommand && !hasUrl) return 'stdio'
  if (hasUrl && !hasCommand) return 'http'
  return 'unknown'
}

function preservableExtensions(existing: unknown, declaration: ReadonlyMcpServerDeclaration): Record<string, unknown> {
  if (!isPlainObject(existing)) return {}
  if (nativeTransport(existing) !== declaration.type) return {}

  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existing)) {
    if (isSafeExtension(key, value)) preserved[key] = value
  }
  return preserved
}

/** Render a portable declaration as a Codex `mcp_servers` entry. */
function renderEntry(
  declaration: ReadonlyMcpServerDeclaration,
  preserved: Record<string, unknown>,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {}

  if (declaration.type === 'stdio') {
    entry.command = declaration.command
    if (declaration.args !== undefined && declaration.args.length > 0) entry.args = [...declaration.args]
    if (declaration.env !== undefined && Object.keys(declaration.env).length > 0) entry.env = { ...declaration.env }
  } else {
    entry.url = declaration.url
  }

  for (const [key, value] of Object.entries(preserved)) {
    entry[key] = value
  }

  return entry
}
