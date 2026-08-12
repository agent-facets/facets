import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ApplyMcpServersResult,
  atomicWriteFileSync,
  errorMessage,
  isMissingFileError,
  type McpNativeMatch,
  type McpServerCapability,
  type McpServerCapabilityFailure,
  type McpServerContribution,
  type McpServerDeclaration,
  mcpDeclarationLiterals,
  mcpOutcomesRequireWrite,
  type PrepareMcpServersRequest,
  type PrepareMcpServersResult,
  reconcileMcpServers,
} from '@agent-facets/adapter'
import { applyEdits, type FormattingOptions, modify, type ParseError, parse as parseJsonc } from 'jsonc-parser'

/**
 * OpenCode MCP server reconciliation.
 *
 * ## Which document
 *
 * OpenCode loads `opencode.json` and then `opencode.jsonc` from the same
 * directory and deep-merges them in that order, so when both exist the JSONC
 * file wins. This adapter therefore reconciles `opencode.jsonc` when it exists,
 * falls back to an existing `opencode.json`, and creates `opencode.jsonc` when
 * neither does. Writing to the losing file would be a silent no-op from the
 * user's point of view — the entry would be there, and OpenCode would still
 * ignore it.
 *
 * ## Why JSONC, and why minimal edits
 *
 * OpenCode parses *both* filenames as JSONC, and its own `opencode mcp add`
 * edits configuration with jsonc-parser's `modify`/`applyEdits`. This adapter
 * does the same, for the same reason: those produce a minimal text edit rather
 * than a re-serialization, so comments, member order, indentation, and trailing
 * commas everywhere outside the one entry being changed survive byte-for-byte.
 * A parse-then-stringify round trip would reflow a hand-formatted config on the
 * first install.
 */

/** Candidate documents, in the order OpenCode's own merge makes authoritative. */
const DOCUMENT_NAMES = ['opencode.jsonc', 'opencode.json'] as const

/** Created when neither candidate exists. */
const DEFAULT_DOCUMENT_NAME = DOCUMENT_NAMES[0]

/** The top-level member OpenCode reads servers from. */
const SERVER_MAP_KEY = 'mcp'

/**
 * OpenCode substitutes these forms inside configuration values before parsing.
 *
 * A portable declaration is literal, so a value containing one of these cannot
 * be written faithfully — OpenCode would replace it with an environment
 * variable or a file's contents. That is a conflict, not something to write and
 * hope about.
 */
const INTERPOLATION_PATTERN = /\{(?:env|file):[^}]*\}/

/** Members OpenCode owns that this adapter renders from the declaration. */
const PORTABLE_KEYS: Readonly<Record<'local' | 'remote', ReadonlySet<string>>> = {
  local: new Set(['type', 'command', 'environment']),
  remote: new Set(['type', 'url']),
}

/**
 * The prepared plan: the selected document, its exact prior text (or `null`
 * when it does not exist), and the complete text to commit.
 */
type OpenCodeMcpPlan =
  | { readonly kind: 'unchanged'; readonly path: string }
  | { readonly kind: 'write'; readonly path: string; readonly expected: string | null; readonly contents: string }

export const openCodeMcpServers: McpServerCapability<OpenCodeMcpPlan> = {
  async prepare(request: PrepareMcpServersRequest): Promise<PrepareMcpServersResult<OpenCodeMcpPlan>> {
    const selected = await selectDocument(request.projectRoot)
    if (!selected.ok) return { ok: false, failure: selected.failure }
    const { path, text } = selected

    for (const contribution of request.desired) {
      const literal = mcpDeclarationLiterals(contribution.declaration).find((value) =>
        INTERPOLATION_PATTERN.test(value),
      )
      if (literal !== undefined) {
        return {
          ok: false,
          failure: {
            code: 'conflict',
            path,
            message: `server "${contribution.name}" declares a value OpenCode would interpolate rather than use literally: ${literal}`,
          },
        }
      }
    }

    let document: Record<string, unknown> = {}
    if (text !== null) {
      const errors: ParseError[] = []
      const parsed: unknown = parseJsonc(text, errors, { allowTrailingComma: true })
      if (errors.length > 0) {
        return { ok: false, failure: { code: 'parse-failed', path, message: describeParseErrors(text, errors) } }
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

    // Each edit is computed against the text the previous one produced:
    // jsonc-parser's edits carry absolute offsets, so they cannot be batched.
    let contents = text ?? '{}\n'
    const formatting = detectFormatting(text)

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
          contents = editDocument(
            contents,
            [SERVER_MAP_KEY, outcome.name],
            renderEntry(contribution.declaration, preserved),
            formatting,
          )
          break
        }
        case 'obsolete-owned':
          if (outcome.occupancy === 'present') {
            contents = editDocument(contents, [SERVER_MAP_KEY, outcome.name], undefined, formatting)
          }
          break
      }
    }

    return {
      ok: true,
      preparation: { plan: { kind: 'write', path, expected: text, contents }, documentPaths: [path], outcomes },
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
          message: 'the OpenCode configuration changed after it was inspected; nothing was written',
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

type SelectDocumentResult =
  | { readonly ok: true; readonly path: string; readonly text: string | null }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

/**
 * Pick the one document to reconcile.
 *
 * When both filenames exist only the JSONC one is read, disclosed, or written —
 * the JSON file is left exactly as it was, because OpenCode already treats it
 * as the losing half of the merge.
 */
async function selectDocument(projectRoot: string): Promise<SelectDocumentResult> {
  for (const name of DOCUMENT_NAMES) {
    const path = join(projectRoot, name)
    try {
      return { ok: true, path, text: await readFile(path, 'utf8') }
    } catch (err) {
      if (!isMissingFileError(err)) {
        return { ok: false, failure: { code: 'io-failed', operation: 'read', path, message: errorMessage(err) } }
      }
    }
  }
  return { ok: true, path: join(projectRoot, DEFAULT_DOCUMENT_NAME), text: null }
}

function editDocument(
  text: string,
  path: readonly [string, string],
  value: Record<string, unknown> | undefined,
  formatting: FormattingOptions,
): string {
  return applyEdits(text, modify(text, [...path], value, { formattingOptions: formatting }))
}

/**
 * Match the document's own indentation so an inserted entry does not look
 * pasted in. A brand-new document gets two spaces, matching what OpenCode
 * writes when it bootstraps a config.
 */
function detectFormatting(text: string | null): FormattingOptions {
  const eol = text?.includes('\r\n') ? '\r\n' : '\n'
  const indent = text?.match(/\n([ \t]+)\S/)?.[1]
  if (indent === undefined) return { tabSize: 2, insertSpaces: true, eol }
  if (indent.startsWith('\t')) return { tabSize: 2, insertSpaces: false, eol }
  return { tabSize: indent.length, insertSpaces: true, eol }
}

function describeParseErrors(text: string, errors: readonly ParseError[]): string {
  const first = errors[0]
  if (first === undefined) return 'invalid JSONC'
  const line = text.slice(0, first.offset).split('\n').length
  return `invalid JSONC at line ${line} (offset ${first.offset})`
}

/**
 * Narrow the opaque plan the engine handed back. A value that fails this check
 * did not come from `prepare`, which is a violated contract rather than a
 * condition a caller could act on.
 */
function asPlan(value: unknown): OpenCodeMcpPlan {
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
  throw new Error('opencode: apply() received a plan this adapter did not produce')
}

/**
 * Compare an existing native entry with the rendering of a desired
 * declaration.
 *
 * OpenCode fuses the executable and its arguments into one `command` array, so
 * equality is checked in that direction only: `['npx', '-y', 'srv']` is the
 * rendering of `{ command: 'npx', args: ['-y', 'srv'] }`, while
 * `['npx -y srv']` is a single argument that happens to contain spaces and is
 * a different launch.
 */
function compareEntry(existing: unknown, declaration: McpServerDeclaration): McpNativeMatch {
  if (!isPlainObject(existing)) return 'divergent'

  const nativeType = nativeTypeFor(declaration.type)
  if (existing.type !== nativeType) return 'divergent'

  if (declaration.type === 'stdio') {
    if (!sameStringArray(existing.command, commandArray(declaration))) return 'divergent'
    if (!sameStringRecord(existing.environment, declaration.env ?? {})) return 'divergent'
  } else if (existing.url !== declaration.url) {
    return 'divergent'
  }

  const portable = PORTABLE_KEYS[nativeType]
  for (const [key, value] of Object.entries(existing)) {
    if (portable.has(key)) continue
    if (!isSafeExtension(key, value)) return 'divergent'
  }

  return 'equivalent'
}

/**
 * Whether a member outside the portable model can be left in place without
 * changing how the server is launched or connected to.
 *
 * `timeout` only tunes how long OpenCode waits. `enabled` is safe only when it
 * is `true`: `enabled: false` means the server the project asked for would not
 * start, which is precisely a behavioral difference.
 *
 * `cwd`, `headers`, and `oauth` are absent by design — they change the working
 * directory a process launches in, or how a connection authenticates.
 */
function isSafeExtension(key: string, value: unknown): boolean {
  if (key === 'timeout') return true
  if (key === 'enabled') return value === true
  return false
}

function nativeTypeFor(transport: McpServerDeclaration['type']): 'local' | 'remote' {
  return transport === 'stdio' ? 'local' : 'remote'
}

function commandArray(declaration: Extract<McpServerDeclaration, { type: 'stdio' }>): string[] {
  return [declaration.command, ...(declaration.args ?? [])]
}

function preservableExtensions(existing: unknown, declaration: McpServerDeclaration): Record<string, unknown> {
  if (!isPlainObject(existing)) return {}
  if (existing.type !== nativeTypeFor(declaration.type)) return {}

  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existing)) {
    if (isSafeExtension(key, value)) preserved[key] = value
  }
  return preserved
}

/**
 * Render a portable declaration in OpenCode's native shape. `environment` is
 * emitted only when non-empty, matching what `opencode mcp add` writes.
 */
function renderEntry(declaration: McpServerDeclaration, preserved: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = { type: nativeTypeFor(declaration.type) }

  if (declaration.type === 'stdio') {
    entry.command = commandArray(declaration)
    if (declaration.env !== undefined && Object.keys(declaration.env).length > 0) {
      entry.environment = { ...declaration.env }
    }
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
