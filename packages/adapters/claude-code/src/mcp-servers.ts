import { join } from 'node:path'
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
import { detectJsoncFormatting, editJsoncProperty, restoreJsoncBom, splitJsoncBom } from '@agent-facets/adapter-jsonc'

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
 * ## Why strict JSON, and why a syntax-aware edit anyway
 *
 * `.mcp.json` is parsed by Claude Code with `JSON.parse`. A comment or a
 * trailing comma is not a stylistic choice this adapter should tolerate — it is
 * a file Claude Code itself rejects, so reporting `parse-failed` tells the user
 * something true and actionable rather than silently "fixing" a document the
 * tool was already ignoring. Validation is therefore strict.
 *
 * Editing is not. Reserializing the whole document to change one entry reflows
 * everything a user arranged — compact arrays, inline objects, aligned
 * properties, deliberate blank lines — even though the indentation and line
 * endings survive. So the mutation goes through the shared syntax-aware editor,
 * which rewrites only the property being changed.
 *
 * ## Why interpolation is a conflict
 *
 * Claude Code expands `${VAR}` inside `.mcp.json` values. A portable
 * declaration is literal, so a value containing that syntax cannot be written
 * faithfully: Claude would launch a different command, receive a substituted
 * secret, or connect to a different URL.
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
 * The syntax Claude Code substitutes inside configuration values before using
 * them. A declaration carrying one cannot be represented literally.
 */
const INTERPOLATION_PATTERN = /\$\{[^}]*\}/

export const claudeCodeMcpServers: McpServerCapability<McpTextPlan> = {
  async prepare(request: PrepareMcpServersRequest): Promise<PrepareMcpServersResult<McpTextPlan>> {
    const path = join(request.projectRoot, DOCUMENT_NAME)

    const read = await readTextOrAbsent(path)
    if (!read.ok) return { ok: false, failure: read.failure }
    const text = read.text

    // Validated strictly, edited syntax-aware: the mark is split off because
    // `JSON.parse` rejects it, and put back because the user's editor would
    // only add it again.
    const { bom, body } = text === null ? { bom: false, body: '{}\n' } : splitJsoncBom(text)

    let document: Record<string, unknown>
    if (text === null) {
      document = {}
    } else {
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch (err) {
        return { ok: false, failure: { code: 'parse-failed', path, message: errorMessage(err) } }
      }
      if (!isPlainObject(parsed)) {
        return {
          ok: false,
          failure: { code: 'validation-failed', path, message: 'document root must be a JSON object' },
        }
      }
      document = parsed
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
    const tracked = new Set(request.previouslyOwnedNames)
    const desiredByName = new Map(request.desired.map((contribution) => [contribution.name, contribution]))

    return prepareMcpTextPlan({
      request,
      documentPaths: [path],
      interpolation: { pattern: INTERPOLATION_PATTERN },
      presentNames: new Set(Object.keys(servers)),
      compare: (contribution) => compareEntry(servers[contribution.name], contribution.declaration),
      buildEdits: (outcomes) => {
        // Each edit is computed against the text the previous one produced:
        // a syntax-aware edit carries absolute offsets, so they cannot be
        // batched against the original document.
        let edited = body
        const formatting = detectJsoncFormatting(text)

        for (const outcome of outcomes) {
          switch (outcome.kind) {
            case 'equivalent':
              break
            case 'absent':
            case 'divergent': {
              const contribution = desiredByName.get(outcome.name) as McpServerContribution
              // Native extras are carried forward only for an entry the project
              // already owns. At an untracked destination the user is consenting
              // to a takeover, not to inheriting settings we cannot vouch for.
              const preserved =
                outcome.kind === 'divergent' && tracked.has(outcome.name)
                  ? preservableExtensions(servers[outcome.name], contribution.declaration)
                  : {}
              edited = editJsoncProperty(
                edited,
                [SERVER_MAP_KEY, outcome.name],
                renderEntry(contribution.declaration, preserved),
                formatting,
              )
              break
            }
            case 'obsolete-owned':
              if (outcome.occupancy === 'present') {
                edited = editJsoncProperty(edited, [SERVER_MAP_KEY, outcome.name], undefined, formatting)
              }
              break
          }
        }

        return { ok: true, edits: [{ path, expected: text, contents: restoreJsoncBom(edited, bom) }] }
      },
    })
  },

  async apply(request: { readonly plan: unknown }): Promise<ApplyMcpServersResult> {
    return applyMcpTextPlan(request.plan, { adapterName: 'claude-code' })
  },
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
function compareEntry(existing: unknown, declaration: ReadonlyMcpServerDeclaration): McpNativeMatch {
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
function preservableExtensions(existing: unknown, declaration: ReadonlyMcpServerDeclaration): Record<string, unknown> {
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
function renderEntry(
  declaration: ReadonlyMcpServerDeclaration,
  preserved: Record<string, unknown>,
): Record<string, unknown> {
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
