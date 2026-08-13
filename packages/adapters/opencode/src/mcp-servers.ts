import { join } from 'node:path'
import {
  type ApplyMcpServersResult,
  applyMcpTextPlan,
  isPlainObject,
  type McpNativeMatch,
  type McpServerCapability,
  type McpServerCapabilityFailure,
  type McpServerContribution,
  type McpTextPlan,
  type PrepareMcpServersRequest,
  type PrepareMcpServersResult,
  prepareMcpTextPlan,
  type ReadonlyMcpServerDeclaration,
  readTextOrAbsent,
  sameStringArray,
  sameStringRecord,
  type TextDocumentEdit,
} from '@agent-facets/adapter'
import { detectJsoncFormatting, editJsoncProperty, parseJsoncDocument } from '@agent-facets/adapter-jsonc'

/**
 * OpenCode MCP server reconciliation.
 *
 * ## Two documents, one configuration
 *
 * OpenCode loads `opencode.json` and then `opencode.jsonc` from the same
 * directory and deep-merges them in that order, so a key defined in both is
 * the JSONC one. That merge is the configuration; neither file is it on its
 * own. So this adapter reads BOTH, classifies against the merged per-key view,
 * and discloses both paths.
 *
 * Reading only the JSONC file was a real defect, not a simplification: an
 * obsolete owned server living only in `opencode.json` looked absent, so
 * removal skipped it and OpenCode went on loading a server the project had
 * deleted.
 *
 * Writes then target the layer that makes the change effective:
 *
 *   - A new entry goes to `opencode.jsonc` when that file exists, otherwise to
 *     an existing `opencode.json`, otherwise into a newly created
 *     `opencode.jsonc`.
 *   - An existing entry is updated in the layer where it currently wins.
 *   - An owned entry defined in BOTH layers is updated in `opencode.jsonc` and
 *     its shadowed `opencode.json` copy is removed in the same change, so the
 *     merged view cannot silently disagree with either file.
 *   - An obsolete owned entry is deleted from every layer that defines it.
 *
 * An entry the project neither desires nor owns is never touched, in either
 * layer.
 *
 * ## Why JSONC, and why minimal edits
 *
 * OpenCode parses *both* filenames as JSONC, and its own `opencode mcp add`
 * edits configuration with a syntax-aware editor. This adapter does the same,
 * for the same reason: a targeted edit is a minimal text change rather than a
 * re-serialization, so comments, member order, indentation, and trailing
 * commas everywhere outside the one entry being changed survive.
 */

/** Candidate documents, in the order OpenCode's own merge makes authoritative. */
const DOCUMENT_NAMES = ['opencode.jsonc', 'opencode.json'] as const

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

/** One configuration layer, as inspected and as being edited. */
interface Layer {
  readonly path: string
  /** The document's exact text when inspected, or `null` when it does not exist. */
  readonly text: string | null
  /** The server entries this layer defines. Empty when the document is absent. */
  readonly servers: Record<string, unknown>
  /** The working text, which starts as the inspected text. */
  contents: string
  /** Whether {@link contents} has diverged from {@link text}. */
  changed: boolean
}

export const openCodeMcpServers: McpServerCapability<McpTextPlan> = {
  async prepare(request: PrepareMcpServersRequest): Promise<PrepareMcpServersResult<McpTextPlan>> {
    const read = await readLayers(request.projectRoot)
    if (!read.ok) return { ok: false, failure: read.failure }
    const [jsonc, json] = read.layers

    // The merged per-key view OpenCode itself sees: the lower layer first, then
    // the winning one over it.
    const merged = new Map<string, unknown>()
    for (const layer of [json, jsonc]) {
      for (const [name, entry] of Object.entries(layer.servers)) merged.set(name, entry)
    }

    const tracked = new Set(request.previouslyOwnedNames)
    const desiredByName = new Map(request.desired.map((contribution) => [contribution.name, contribution]))

    return prepareMcpTextPlan({
      request,
      documentPaths: [jsonc.path, json.path],
      interpolation: { pattern: INTERPOLATION_PATTERN, path: jsonc.path },
      presentNames: new Set(merged.keys()),
      compare: (contribution) => compareEntry(merged.get(contribution.name), contribution.declaration),
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
                  ? preservableExtensions(merged.get(outcome.name), contribution.declaration)
                  : {}
              const target = writeTargetFor(outcome.name, jsonc, json)
              setEntry(target, outcome.name, renderEntry(contribution.declaration, preserved))
              // A copy in the losing layer would keep shadowing this one on
              // every future read, so the two would drift apart silently.
              if (target === jsonc && Object.hasOwn(json.servers, outcome.name)) {
                setEntry(json, outcome.name, undefined)
              }
              break
            }
            case 'obsolete-owned':
              // Deleted from every layer that defines it: the merged view is
              // only free of the entry when no layer still carries it.
              for (const layer of [jsonc, json]) {
                if (Object.hasOwn(layer.servers, outcome.name)) setEntry(layer, outcome.name, undefined)
              }
              break
          }
        }

        const edits: TextDocumentEdit[] = []
        for (const layer of [jsonc, json]) {
          if (layer.changed) edits.push({ path: layer.path, expected: layer.text, contents: layer.contents })
        }
        return { ok: true, edits }
      },
    })
  },

  async apply(request: { readonly plan: unknown }): Promise<ApplyMcpServersResult> {
    return applyMcpTextPlan(request.plan, { adapterName: 'opencode' })
  },
}

type ReadLayersResult =
  | { readonly ok: true; readonly layers: readonly [Layer, Layer] }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

/**
 * Read and parse both layers.
 *
 * Both are always disclosed, including one that does not exist: "absent" is a
 * preimage the caller can restore to, and a run that creates the JSONC file
 * has to be able to put its absence back.
 */
async function readLayers(projectRoot: string): Promise<ReadLayersResult> {
  const layers: Layer[] = []

  for (const name of DOCUMENT_NAMES) {
    const path = join(projectRoot, name)
    const read = await readTextOrAbsent(path)
    if (!read.ok) return { ok: false, failure: read.failure }

    const parsed = parseLayer(path, read.text)
    if (!parsed.ok) return { ok: false, failure: parsed.failure }
    layers.push(parsed.layer)
  }

  const [jsonc, json] = layers
  // Unreachable: `DOCUMENT_NAMES` has exactly two entries and the loop pushes
  // one layer per entry or returns.
  if (jsonc === undefined || json === undefined) {
    throw new Error('opencode: expected one layer per candidate document')
  }
  return { ok: true, layers: [jsonc, json] }
}

type ParseLayerResult =
  | { readonly ok: true; readonly layer: Layer }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

function parseLayer(path: string, text: string | null): ParseLayerResult {
  if (text === null) {
    return { ok: true, layer: { path, text: null, servers: {}, contents: '{}\n', changed: false } }
  }

  const parsed = parseJsoncDocument(text)
  if (!parsed.ok) {
    return { ok: false, failure: { code: 'parse-failed', path, message: parsed.message } }
  }
  if (!isPlainObject(parsed.value)) {
    return { ok: false, failure: { code: 'validation-failed', path, message: 'document root must be a JSON object' } }
  }

  const rawServers = parsed.value[SERVER_MAP_KEY]
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

  return { ok: true, layer: { path, text, servers: rawServers ?? {}, contents: text, changed: false } }
}

/**
 * The layer a write must target for this name to take effect.
 *
 * An existing key is updated where it currently wins; a new one goes to the
 * preferred existing document, or to a newly created JSONC file when neither
 * exists. Writing anywhere else would leave the merged view unchanged, which
 * from the user's point of view is a silent no-op.
 */
function writeTargetFor(name: string, jsonc: Layer, json: Layer): Layer {
  if (Object.hasOwn(jsonc.servers, name)) return jsonc
  if (Object.hasOwn(json.servers, name)) return json
  if (jsonc.text !== null) return jsonc
  if (json.text !== null) return json
  return jsonc
}

/**
 * Set or delete one server entry in a layer's working text.
 *
 * Each edit is computed against the text the previous one produced: a
 * syntax-aware edit carries absolute offsets, so they cannot be batched.
 */
function setEntry(layer: Layer, name: string, value: Record<string, unknown> | undefined): void {
  layer.contents = editJsoncProperty(layer.contents, [SERVER_MAP_KEY, name], value, detectJsoncFormatting(layer.text))
  layer.changed = layer.contents !== layer.text
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
function compareEntry(existing: unknown, declaration: ReadonlyMcpServerDeclaration): McpNativeMatch {
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

function nativeTypeFor(transport: ReadonlyMcpServerDeclaration['type']): 'local' | 'remote' {
  return transport === 'stdio' ? 'local' : 'remote'
}

function commandArray(declaration: Extract<ReadonlyMcpServerDeclaration, { type: 'stdio' }>): string[] {
  return [declaration.command, ...(declaration.args ?? [])]
}

function preservableExtensions(existing: unknown, declaration: ReadonlyMcpServerDeclaration): Record<string, unknown> {
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
function renderEntry(
  declaration: ReadonlyMcpServerDeclaration,
  preserved: Record<string, unknown>,
): Record<string, unknown> {
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
