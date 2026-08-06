import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ApplyMcpServersResult,
  atomicWriteFileSync,
  errorMessage,
  isMissingFileError,
  type McpNativeMatch,
  type McpServerCapability,
  type McpServerContribution,
  type McpServerDeclaration,
  mcpOutcomesRequireWrite,
  type PrepareMcpServersRequest,
  type PrepareMcpServersResult,
  reconcileMcpServers,
} from '@agent-facets/adapter'

/**
 * Claude Code MCP server reconciliation.
 *
 * ## The document
 *
 * Claude Code reads project-scoped servers from `<projectRoot>/.mcp.json`
 * under a top-level `mcpServers` map. That file — and only that file — is what
 * this capability touches. Claude Code also merges a local scope out of
 * `~/.claude.json` and a user scope beside it, but user-wide configuration is
 * explicitly out of bounds, so an entry written here can still be shadowed by
 * one a user set locally. That is the user's decision to make and not ours to
 * silently override.
 *
 * ## Why strict JSON
 *
 * `.mcp.json` is parsed by Claude Code with `JSON.parse`. A comment or a
 * trailing comma is not a stylistic choice this adapter should tolerate — it is
 * a file Claude Code itself rejects, so reporting `parse-failed` tells the user
 * something true and actionable rather than silently "fixing" a document the
 * tool was already ignoring. That also means there is no comment-preservation
 * problem here and no parser dependency: parse, mutate the keys we own,
 * re-serialize in the document's own indentation and line endings.
 */

/** The only document this capability reads or writes. */
const DOCUMENT_NAME = '.mcp.json'

/** The top-level member Claude Code reads project servers from. */
const SERVER_MAP_KEY = 'mcpServers'

/**
 * Members of a native entry that are outside the portable model but do not
 * change how the server is launched or connected to, so they survive an update
 * to an entry the project already owns.
 *
 * `timeout` and `alwaysLoad` tune startup and tool-search behavior; `role`,
 * `tools`, and `toolPermissions` narrow which tools Claude Code surfaces. None
 * of them decides what process runs or what endpoint is dialed.
 *
 * Conspicuously absent: `headers`, `headersHelper`, and `oauth`. Those decide
 * how a connection authenticates — `headersHelper` literally runs a shell
 * command — so an entry carrying one cannot be proven equal to a portable
 * declaration that carries no credentials at all.
 */
const SAFE_EXTENSION_KEYS: ReadonlySet<string> = new Set(['timeout', 'alwaysLoad', 'role', 'tools', 'toolPermissions'])

/** Members this adapter owns outright, per transport. */
const PORTABLE_KEYS: Readonly<Record<'stdio' | 'http', ReadonlySet<string>>> = {
  stdio: new Set(['type', 'command', 'args', 'env']),
  http: new Set(['type', 'url']),
}

/**
 * The prepared plan.
 *
 * `expected` is the document's exact prior text, or `null` when it did not
 * exist. `apply` re-reads and compares before writing, so a document a user (or
 * Claude Code) changed in the window between planning and committing is
 * reported as a conflict rather than silently overwritten with a plan built
 * from stale bytes.
 */
type ClaudeMcpPlan =
  | { readonly kind: 'unchanged'; readonly path: string }
  | { readonly kind: 'write'; readonly path: string; readonly expected: string | null; readonly contents: string }

/** How the document is laid out, so a rewrite looks like the file we read. */
interface DocumentFormat {
  readonly indent: string
  readonly newline: string
  readonly trailingNewline: boolean
  readonly bom: boolean
}

const DEFAULT_FORMAT: DocumentFormat = { indent: '  ', newline: '\n', trailingNewline: true, bom: false }

export const claudeCodeMcpServers: McpServerCapability<ClaudeMcpPlan> = {
  async prepare(request: PrepareMcpServersRequest): Promise<PrepareMcpServersResult<ClaudeMcpPlan>> {
    const path = join(request.projectRoot, DOCUMENT_NAME)

    let text: string | null
    try {
      text = await readFile(path, 'utf8')
    } catch (err) {
      if (!isMissingFileError(err)) {
        return { ok: false, failure: { code: 'io-failed', operation: 'read', path, message: errorMessage(err) } }
      }
      text = null
    }

    let document: Record<string, unknown>
    let format: DocumentFormat
    if (text === null) {
      document = {}
      format = DEFAULT_FORMAT
    } else {
      const parsed = parseDocument(text)
      if (!parsed.ok) {
        return { ok: false, failure: { ...parsed.failure, path } }
      }
      document = parsed.document
      format = parsed.format
    }

    const rawServers = document[SERVER_MAP_KEY]
    if (rawServers !== undefined && !isPlainObject(rawServers)) {
      return {
        ok: false,
        failure: {
          code: 'validation-failed',
          path,
          message: `"${SERVER_MAP_KEY}" must be an object mapping server names to entries`,
        },
      }
    }
    const servers: Record<string, unknown> = rawServers ?? {}

    const outcomes = reconcileMcpServers({
      desired: request.desired,
      previouslyOwnedNames: request.previouslyOwnedNames,
      presentNames: new Set(Object.keys(servers)),
      compare: (contribution) => compareEntry(servers[contribution.name], contribution.declaration),
    })

    if (!mcpOutcomesRequireWrite(outcomes)) {
      return { ok: true, preparation: { plan: { kind: 'unchanged', path }, documentPaths: [path], outcomes } }
    }

    const tracked = new Set(request.previouslyOwnedNames)
    const desiredByName = new Map(request.desired.map((contribution) => [contribution.name, contribution]))

    for (const outcome of outcomes) {
      switch (outcome.kind) {
        case 'equivalent':
          break
        case 'absent':
        case 'divergent': {
          const contribution = desiredByName.get(outcome.name) as McpServerContribution
          // Native extras are carried forward only for an entry the project
          // already owns. At an untracked destination the user is consenting to
          // a takeover, not to inheriting settings we cannot vouch for.
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

    // Assigning the map back matters only when the document had no `mcpServers`
    // member; when it did, `servers` is that same object and this is a no-op
    // that keeps its position among the document's other members.
    document[SERVER_MAP_KEY] = servers

    return {
      ok: true,
      preparation: {
        plan: { kind: 'write', path, expected: text, contents: serializeDocument(document, format) },
        documentPaths: [path],
        outcomes,
      },
    }
  },

  async apply(request: { readonly plan: unknown }): Promise<ApplyMcpServersResult> {
    const plan = asPlan(request.plan)

    if (plan.kind === 'unchanged') {
      return { ok: true, status: 'unchanged' }
    }

    let current: string | null
    try {
      current = await readFile(plan.path, 'utf8')
    } catch (err) {
      if (!isMissingFileError(err)) {
        return {
          ok: false,
          failure: { code: 'io-failed', operation: 'read', path: plan.path, message: errorMessage(err) },
        }
      }
      current = null
    }

    if (current !== plan.expected) {
      return {
        ok: false,
        failure: {
          code: 'conflict',
          path: plan.path,
          message: `${DOCUMENT_NAME} changed after it was inspected; nothing was written`,
        },
      }
    }

    try {
      atomicWriteFileSync(plan.path, plan.contents)
    } catch (err) {
      return {
        ok: false,
        failure: { code: 'io-failed', operation: 'write', path: plan.path, message: errorMessage(err) },
      }
    }

    return { ok: true, status: 'changed', changedPaths: [plan.path] }
  },
}

/**
 * Narrow the opaque plan the engine handed back.
 *
 * The engine's contract is to return exactly what `prepare` produced, so a
 * value that fails this check is a violated invariant rather than a condition a
 * caller could handle — the one case where throwing is the honest answer.
 */
function asPlan(value: unknown): ClaudeMcpPlan {
  if (isPlainObject(value)) {
    if (value.kind === 'unchanged' && typeof value.path === 'string') {
      return { kind: 'unchanged', path: value.path }
    }
    if (
      value.kind === 'write' &&
      typeof value.path === 'string' &&
      typeof value.contents === 'string' &&
      (value.expected === null || typeof value.expected === 'string')
    ) {
      return { kind: 'write', path: value.path, expected: value.expected, contents: value.contents }
    }
  }
  throw new Error('claude-code: apply() received a plan this adapter did not produce')
}

type ParseDocumentResult =
  | { readonly ok: true; readonly document: Record<string, unknown>; readonly format: DocumentFormat }
  | { readonly ok: false; readonly failure: { readonly code: 'parse-failed' | 'validation-failed'; message: string } }

function parseDocument(text: string): ParseDocumentResult {
  const bom = text.charCodeAt(0) === 0xfeff
  const body = bom ? text.slice(1) : text

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (err) {
    return { ok: false, failure: { code: 'parse-failed', message: errorMessage(err) } }
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, failure: { code: 'validation-failed', message: 'document root must be a JSON object' } }
  }

  return { ok: true, document: parsed, format: detectFormat(body, bom) }
}

function detectFormat(body: string, bom: boolean): DocumentFormat {
  const newline = body.includes('\r\n') ? '\r\n' : '\n'
  const indentMatch = body.match(/\n([ \t]+)\S/)
  return {
    indent: indentMatch?.[1] ?? DEFAULT_FORMAT.indent,
    newline,
    trailingNewline: /\r?\n\s*$/.test(body),
    bom,
  }
}

function serializeDocument(document: Record<string, unknown>, format: DocumentFormat): string {
  let text = JSON.stringify(document, null, format.indent)
  if (format.newline !== '\n') {
    text = text.replaceAll('\n', format.newline)
  }
  if (format.trailingNewline) {
    text += format.newline
  }
  return format.bom ? `\uFEFF${text}` : text
}

/**
 * Compare an existing native entry with the rendering of a desired
 * declaration.
 *
 * Everything that is not proof of equality is `divergent` — a shape this
 * adapter does not recognize, a transport it cannot classify, or an extra
 * member outside the safe set all fail closed rather than adopting an entry
 * whose behavior we would be guessing at.
 */
function compareEntry(existing: unknown, declaration: McpServerDeclaration): McpNativeMatch {
  if (!isPlainObject(existing)) return 'divergent'

  const transport = effectiveTransport(existing)
  if (transport !== declaration.type) return 'divergent'

  if (declaration.type === 'stdio') {
    if (existing.command !== declaration.command) return 'divergent'
    if (!sameStringArray(existing.args, declaration.args ?? [])) return 'divergent'
    if (!sameStringRecord(existing.env, declaration.env ?? {})) return 'divergent'
  } else if (existing.url !== declaration.url) {
    return 'divergent'
  }

  // A member we do not own and cannot vouch for could change behavior in a way
  // this comparison did not model, so its mere presence defeats the proof.
  const portable = PORTABLE_KEYS[declaration.type]
  for (const key of Object.keys(existing)) {
    if (portable.has(key)) continue
    if (!SAFE_EXTENSION_KEYS.has(key)) return 'divergent'
  }

  return 'equivalent'
}

/**
 * The transport an existing entry actually uses.
 *
 * Claude Code's stdio arm leaves `type` optional, and accepts both `http` and
 * `streamable-http` for the same Streamable HTTP transport — a hand-written or
 * copy-pasted entry that spells either of those is not a difference worth
 * prompting about. Anything else (`sse`, `ws`, an unknown tag) is a transport
 * this adapter does not model, and reports as such.
 */
function effectiveTransport(existing: Record<string, unknown>): 'stdio' | 'http' | 'unknown' {
  const declared = existing.type
  if (declared === undefined) return 'stdio'
  if (declared === 'stdio') return 'stdio'
  if (declared === 'http' || declared === 'streamable-http') return 'http'
  return 'unknown'
}

/** The safe native members of an existing entry, when its transport is unchanged. */
function preservableExtensions(existing: unknown, declaration: McpServerDeclaration): Record<string, unknown> {
  if (!isPlainObject(existing)) return {}
  // Across a transport change the whole entry is replaced: an http-only tool
  // allowlist means nothing on a stdio entry.
  if (effectiveTransport(existing) !== declaration.type) return {}

  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existing)) {
    if (SAFE_EXTENSION_KEYS.has(key)) preserved[key] = value
  }
  return preserved
}

/**
 * Render a portable declaration in Claude Code's native shape.
 *
 * `args` and `env` are emitted only when non-empty: an omitted optional
 * collection and an empty one mean the same thing, and the shorter form is what
 * `claude mcp add` writes.
 */
function renderEntry(declaration: McpServerDeclaration, preserved: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = { type: declaration.type }

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  if (value === undefined) return expected.length === 0
  if (!Array.isArray(value) || value.length !== expected.length) return false
  return value.every((item, index) => item === expected[index])
}

function sameStringRecord(value: unknown, expected: Readonly<Record<string, string>>): boolean {
  const expectedKeys = Object.keys(expected)
  if (value === undefined) return expectedKeys.length === 0
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== expectedKeys.length) return false
  return keys.every((key) => value[key] === expected[key])
}
