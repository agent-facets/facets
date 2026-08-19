import { join } from 'node:path'
import {
  isPlainObject,
  type McpNativeMatch,
  type McpServerCapability,
  type McpServerCapabilityFailure,
  type McpServerContribution,
  type McpTextDocument,
  type PlanMcpServersRequest,
  type PlanMcpServersResult,
  prepareMcpTextPlan,
  type ReadonlyMcpServerDeclaration,
  readTextOrAbsent,
  sameStringArray,
  sameStringRecord,
  type TextDocumentEdit,
} from '@agent-facets/adapter'
import {
  detectJsoncFormatting,
  editJsoncProperty,
  parseJsoncDocument,
  restoreJsoncBom,
  splitJsoncBom,
} from '@agent-facets/adapter-jsonc'

/**
 * OpenCode MCP server reconciliation.
 *
 * ## Four documents, one configuration
 *
 * OpenCode merges four project-scoped configuration documents. It loads the
 * project root's `opencode.json` and `opencode.jsonc` first, then
 * `.opencode/opencode.json` and `.opencode/opencode.jsonc`, deep-merging each
 * over the ones before it. A key defined in more than one of them takes its
 * value from the last one loaded, so precedence runs:
 *
 *   1. `.opencode/opencode.jsonc`  (wins)
 *   2. `.opencode/opencode.json`
 *   3. `opencode.jsonc`
 *   4. `opencode.json`
 *
 * That merge is the configuration; no one file is it on its own. So this
 * adapter reads ALL four, classifies against the merged per-key view, and
 * discloses all four paths.
 *
 * Reading fewer of them was a real defect, not a simplification: an obsolete
 * owned server living only in a document this adapter never opened looked
 * absent, so removal skipped it and OpenCode went on loading a server the
 * project had deleted.
 *
 * ## One write target
 *
 * Every write for a desired server goes to a single document, chosen once per
 * run:
 *
 *   1. the highest-precedence document that already defines an `mcp` member —
 *      an empty `{}` counts, since that is still where this project keeps its
 *      servers;
 *   2. otherwise the highest-precedence document that exists at all;
 *   3. otherwise `.opencode/opencode.jsonc`, created.
 *
 * Following the user's own `mcp` member rather than merely the
 * highest-precedence file that happens to exist is what keeps this adapter out
 * of the way: a project whose `.opencode/opencode.jsonc` holds only agents,
 * with its servers in a root `opencode.json`, gets its servers where its
 * servers already are.
 *
 * A copy of a desired server in a lower-precedence document is left exactly as
 * it is. It is shadowed and inert, this adapter did not put it there, and
 * deleting from a document this run is not otherwise writing is not this
 * adapter's call to make.
 *
 * An obsolete owned entry is the one exception: it is deleted from every
 * document that defines it, because removing only the winning copy would
 * promote a shadowed one and leave the server configured.
 *
 * An entry the project neither desires nor owns is never touched, in any
 * document.
 *
 * ## Why JSONC, and why minimal edits
 *
 * OpenCode parses *every* one of these filenames as JSONC, and its own
 * `opencode mcp add` edits configuration with a syntax-aware editor. This
 * adapter does the same, for the same reason: a targeted edit is a minimal
 * text change rather than a re-serialization, so comments, member order,
 * indentation, and trailing commas everywhere outside the one entry being
 * changed survive.
 */

/**
 * Candidate documents, highest precedence first.
 *
 * The single source of truth for the whole capability: reading, disclosure,
 * the merged view, target selection, and edit order all derive from this one
 * order, so none of them can disagree with another.
 */
const CANDIDATE_PATHS = [
  '.opencode/opencode.jsonc',
  '.opencode/opencode.json',
  'opencode.jsonc',
  'opencode.json',
] as const satisfies readonly [string, ...string[]]

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
 * Whether a document that exists defines the member OpenCode reads servers
 * from, and what it held.
 *
 * A state rather than a possibly-empty record, because the two cases decide
 * different things. A document carrying `"mcp": {}` is where this project
 * keeps its servers even while it keeps none; a document with no `mcp` member
 * is one this adapter would be introducing MCP configuration into. Collapsing
 * them would make target selection unable to tell those apart.
 */
type ServerMapState =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'configured'; readonly entries: Readonly<Record<string, unknown>> }

/**
 * A layer's document as it was found on disk.
 *
 * The mark is split off rather than carried inline because every parser here
 * treats a leading `\uFEFF` as a syntax error, while the file must keep it:
 * dropping it rewrites a file the user's editor would only mark again. Storing
 * the split form is what makes "which text do I parse" and "which text do I
 * compare against" impossible to confuse — the exact original is derived from
 * these two fields, never stored beside them.
 *
 * The server map hangs off the `present` arm alone: a document that does not
 * exist cannot define one, and hoisting the field would make that combination
 * representable for no gain.
 */
type LayerSource =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'present'
      readonly bom: boolean
      readonly body: string
      /**
       * What this document defined when it was inspected. A snapshot on
       * purpose: every target and removal decision is made against the view
       * OpenCode itself loaded, not against a half-edited document.
       */
      readonly servers: ServerMapState
    }

/** One configuration layer, as inspected and as being edited. */
interface Layer {
  readonly path: string
  /**
   * The document's exact state when it was inspected. Carried so a plan can
   * state the precondition it was computed from, and so the caller can restore
   * these very bytes if the operation fails.
   */
  readonly document: McpTextDocument
  readonly source: LayerSource
  /** The working body, mark-free like {@link LayerSource}'s. */
  workingBody: string
}

/** Shared empty view for a layer that defines no entries. */
const NO_ENTRIES: Readonly<Record<string, unknown>> = Object.freeze({})

/** The entries this layer defined when it was inspected. */
function definedEntries(layer: Layer): Readonly<Record<string, unknown>> {
  if (layer.source.kind !== 'present') return NO_ENTRIES
  return layer.source.servers.kind === 'configured' ? layer.source.servers.entries : NO_ENTRIES
}

/** Whether this layer itself defines an entry under `name`. */
function defines(layer: Layer, name: string): boolean {
  return Object.hasOwn(definedEntries(layer), name)
}

/** The body a first edit starts from: the document's own, or a fresh object. */
function startingBody(source: LayerSource): string {
  return source.kind === 'absent' ? '{}\n' : source.body
}

/**
 * The edit this layer would commit, or `null` when it would commit nothing.
 *
 * Derived by comparison rather than tracked by a flag set beside the working
 * body, so "changed" cannot disagree with the text. It also makes writing an
 * untouched absent document unrepresentable rather than merely unreached: the
 * fresh `{}` body only differs from itself once something edits it.
 */
function pendingEdit(layer: Layer): TextDocumentEdit | null {
  if (layer.workingBody === startingBody(layer.source)) return null
  const bom = layer.source.kind === 'present' && layer.source.bom
  return { path: layer.path, contents: restoreJsoncBom(layer.workingBody, bom) }
}

export const openCodeMcpServers: McpServerCapability = {
  async plan(request: PlanMcpServersRequest): Promise<PlanMcpServersResult> {
    const read = readLayers(request.projectRoot)
    if (!read.ok) return { ok: false, failure: read.failure }
    const layers = read.layers

    // The merged per-key view OpenCode itself sees: lowest precedence first,
    // each layer written over the ones it outranks.
    const merged = new Map<string, unknown>()
    for (const layer of [...layers].reverse()) {
      for (const [name, entry] of Object.entries(definedEntries(layer))) merged.set(name, entry)
    }

    const target = selectTarget(layers)
    const tracked = new Set(request.previouslyOwnedNames)
    const desiredByName = new Map(request.desired.map((contribution) => [contribution.name, contribution]))

    const [highest, ...lower] = layers
    return prepareMcpTextPlan({
      request,
      documents: [highest.document, ...lower.map((layer) => layer.document)],
      interpolation: { pattern: INTERPOLATION_PATTERN },
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
              // One target for the whole run. A shadowed copy in a
              // lower-precedence document is inert and was not put there by
              // this adapter, so it is left exactly as its author wrote it.
              setEntry(target, outcome.name, renderEntry(contribution.declaration, preserved))
              break
            }
            case 'obsolete-owned':
              // Deleted from every layer that defines it: the merged view is
              // only free of the entry when no layer still carries it, and
              // removing just the winning copy would promote a shadowed one.
              for (const layer of layers) {
                if (defines(layer, outcome.name)) setEntry(layer, outcome.name, undefined)
              }
              break
          }
        }

        const edits: TextDocumentEdit[] = []
        for (const layer of layers) {
          const edit = pendingEdit(layer)
          if (edit !== null) edits.push(edit)
        }
        return { ok: true, edits }
      },
    })
  },
}

type ReadLayersResult =
  | { readonly ok: true; readonly layers: readonly [Layer, ...Layer[]] }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

/**
 * Read and parse every candidate document, highest precedence first.
 *
 * All are disclosed, including ones that do not exist: "absent" is a preimage
 * the caller can restore to, and a run that creates a document has to be able
 * to put its absence back.
 *
 * The tuple is built from {@link CANDIDATE_PATHS}'s own head and tail rather
 * than accumulated into an array, so "at least one layer" is carried by the
 * type instead of asserted afterwards by a check that could never fire.
 */
function readLayers(projectRoot: string): ReadLayersResult {
  const [highestPath, ...lowerPaths] = CANDIDATE_PATHS

  const highest = readLayer(projectRoot, highestPath)
  if (!highest.ok) return { ok: false, failure: highest.failure }

  const lower: Layer[] = []
  for (const candidate of lowerPaths) {
    const read = readLayer(projectRoot, candidate)
    if (!read.ok) return { ok: false, failure: read.failure }
    lower.push(read.layer)
  }

  return { ok: true, layers: [highest.layer, ...lower] }
}

/**
 * The one document every desired-server write goes to.
 *
 * The highest-precedence document that already defines an `mcp` member, else
 * the highest-precedence one that exists, else the highest-precedence
 * candidate — which this run then creates. Preferring an existing `mcp` member
 * over mere existence is deliberate: it puts servers where this project's
 * servers already live rather than splitting them across two files that
 * shadow each other.
 */
function selectTarget(layers: readonly [Layer, ...Layer[]]): Layer {
  const configured = layers.find(
    (layer) => layer.source.kind === 'present' && layer.source.servers.kind === 'configured',
  )
  if (configured !== undefined) return configured

  const existing = layers.find((layer) => layer.source.kind === 'present')
  if (existing !== undefined) return existing

  return layers[0]
}

type ReadLayerResult =
  | { readonly ok: true; readonly layer: Layer }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

function readLayer(projectRoot: string, candidate: string): ReadLayerResult {
  const read = readTextOrAbsent(join(projectRoot, candidate))
  if (!read.ok) return { ok: false, failure: read.failure }
  return parseLayer(read.document, read.text)
}

function parseLayer(document: McpTextDocument, text: string | null): ReadLayerResult {
  const path = document.path
  if (text === null) {
    const source = { kind: 'absent' } as const
    return { ok: true, layer: { path, document, source, workingBody: startingBody(source) } }
  }

  const { bom, body } = splitJsoncBom(text)
  const parsed = parseJsoncDocument(body)
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

  const servers: ServerMapState =
    rawServers === undefined ? { kind: 'unconfigured' } : { kind: 'configured', entries: rawServers }
  const source = { kind: 'present', bom, body, servers } as const
  return { ok: true, layer: { path, document, source, workingBody: startingBody(source) } }
}

/**
 * Set or delete one server entry in a layer's working body.
 *
 * Each edit is computed against the text the previous one produced: a
 * syntax-aware edit carries absolute offsets, so they cannot be batched. The
 * layout is taken from the document as inspected, so a run of edits cannot
 * drift onto the shape its own first edit produced.
 */
function setEntry(layer: Layer, name: string, value: Record<string, unknown> | undefined): void {
  const formatting = detectJsoncFormatting(layer.source.kind === 'absent' ? null : layer.source.body)
  layer.workingBody = editJsoncProperty(layer.workingBody, [SERVER_MAP_KEY, name], value, formatting)
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
