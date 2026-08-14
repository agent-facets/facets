/**
 * Machine-local install receipt.
 *
 * The receipt records what this machine has materialized into each
 * project's adapter trees, separate from the lockfile. Because the
 * lockfile is shared and version-controlled, it cannot reliably
 * describe what a particular machine has on disk — a `git pull` can
 * remove a lockfile entry while that facet's assets remain materialized.
 *
 * One receipt file per project, stored under `$FACET_DIR/receipts/`.
 * The filename is `<basename>-<hash>.json` where `<hash>` is the first
 * 12 hex characters of `sha256(realpath(projectDir))`. The receipt
 * embeds the canonical project path for self-identification — a
 * mismatch on load fails closed, and a receipt that fails to load in
 * any way witnesses NOTHING rather than being projected from the
 * lockfile: the lockfile is shared state and cannot witness this
 * machine.
 *
 * Assets are stored as semantic tuples `{ scope, type, name }` — the
 * same adapter-agnostic shape as the lockfile. Deletion goes through
 * adapters, not raw filesystem paths. Name validation on load rejects
 * crafted names that could cause path traversal.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  type AssetType,
  atomicWriteFileSync,
  decodeFileText,
  describeInspectFailure,
  errorMessage,
  type FileState,
  inspectFileState,
  type Scope,
  validateAssetName,
} from '@agent-facets/common'
import {
  canonicalPrimaryPath,
  isMaterialized,
  isMcpServerFingerprint,
  lockedDispositionOf,
  type MaterializedDisposition,
  MaterializedDispositionSchema,
  type McpServerFingerprint,
  type SupportedLockfileAssetEntry,
  type SupportedLockfileFacet,
  sameDisposition,
  validateMcpServerName,
} from '@agent-facets/protocol'
import { type } from 'arktype'
import { facetReceiptsDir } from '../facet-dir.ts'
import { jsonFileText } from '../json-file-text.ts'
import { ownRecord } from './own-entry.ts'
import type { AssetIdentity } from './types.ts'

// ---------------------------------------------------------------------------
// Versions (exact dispatch, mirroring the lockfile — design D10)
// ---------------------------------------------------------------------------

/**
 * The legacy receipt schema version. Numeric `1` identifies ONLY the previous
 * alpha shape: asset entries with no owned-file records. Legacy installs
 * could not materialize companions, so a legacy receipt is safely refined to
 * primary-only ownership on load. Version dispatch is exact, never ordered.
 */
export const LEGACY_RECEIPT_VERSION = 1

/**
 * The preceding receipt schema version. Numeric `0.2` identifies ONLY the
 * shape with owned-file records but no materialization disposition: every
 * asset in a `0.2` receipt was materialized under its authored name.
 */
export const RECEIPT_VERSION_0_2 = 0.2

/**
 * The preceding receipt schema version. Numeric `0.3` identifies ONLY the
 * shape with owned-file records and materialization dispositions, but no
 * facet integrity and no configuration claims: it can witness what this
 * machine put on disk as FILES, and nothing about MCP configuration.
 */
export const RECEIPT_VERSION_0_3 = 0.3

/**
 * The current receipt schema version.
 *
 * A current receipt records, for each asset actually present on disk: its
 * AUTHORED identity, the AUTHORED inner-archive paths it owns, and the
 * disposition under which it was materialized. Both names are needed for
 * offline deletion — the authored name anchors ownership and canonical
 * paths, the effective name is what the adapter must be asked to delete —
 * and neither can be derived from the other once a project aliases an
 * asset. The receipt stores paths only, never adapter-encoded hashes.
 *
 * Omitted assets never appear: a disposition here admits only the two arms
 * that put bytes on disk, which makes "omitted but materialized"
 * unrepresentable rather than merely unlikely.
 *
 * `0.4` additionally records, per facet, the resolved facet integrity that
 * witnessed the entry and the MCP configuration claims this machine
 * successfully reconciled. Those claims are simultaneously keyed deletion
 * authority and this machine's evidence of prior approval, and they carry a
 * fingerprint rather than a declaration, so the record proves what was
 * approved without storing a command, URL, or environment data.
 */
export const CURRENT_RECEIPT_VERSION = 0.4

/**
 * Every readable version that predates configuration claims.
 *
 * Derived from the constants rather than restated, so adding a version
 * cannot leave this union describing a set that no longer exists.
 */
export type PreConfigurationReceiptVersion =
  | typeof LEGACY_RECEIPT_VERSION
  | typeof RECEIPT_VERSION_0_2
  | typeof RECEIPT_VERSION_0_3

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * A receipt asset record: authored identity, the complete set of owned
 * authored inner-archive file paths, and the materialization disposition. A
 * skill owns `skills/<name>/SKILL.md` plus every materialized companion; an
 * agent or command owns exactly its single conventional primary file.
 * Companion paths are the engine-supplied `ownedCompanionPaths` handed to the
 * adapter delete request, so offline multi-file cleanup is exact.
 *
 * Shared by `0.3` and `0.4`: configuration claims were added beside asset
 * ownership, not on top of it, so the asset shape is identical in both and
 * restating it would let the two drift.
 */
const ReceiptAssetSchema = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
  materialization: MaterializedDispositionSchema,
  files: 'string[]',
})

/** The members a configuration claim may carry, and nothing else. */
const CONFIGURATION_CLAIM_MEMBERS: ReadonlySet<string> = new Set(['kind', 'name', 'materialization', 'fingerprint'])

/**
 * A current (`0.4`) MCP configuration claim.
 *
 * Closed, unlike most schemas in this repository: an unrecognized member here
 * would be a place for a command, a URL, or an environment value to live in a
 * file whose entire contract is that it holds none of them. Arktype tolerates
 * extra keys by default, so the closure is explicit.
 *
 * `name` is AUTHORED and `materialization` derives the effective identity,
 * exactly as for assets. `fingerprint` stands in for the declaration itself;
 * its spelling is validated with the declaration's own semantic checks during
 * entry validation, where a bad value drops one claim rather than the
 * document.
 */
const ReceiptConfigurationClaimSchema = type({
  kind: "'mcp-server'",
  name: 'string',
  materialization: MaterializedDispositionSchema,
  fingerprint: 'string',
}).narrow((data, ctx) => {
  const stray = Object.keys(data).filter((key) => !CONFIGURATION_CLAIM_MEMBERS.has(key))
  if (stray.length > 0) {
    return ctx.mustBe(`a configuration claim without the unrecognized member "${stray[0]}"`)
  }
  return true
})

const CurrentReceiptFacetEntrySchema = type({
  version: 'string',
  /** The resolved facet integrity that witnessed this entry's claims. */
  integrity: 'string',
  assets: ReceiptAssetSchema.array(),
  configurations: ReceiptConfigurationClaimSchema.array(),
})

const CurrentReceiptSchema = type({
  version: type.unit(CURRENT_RECEIPT_VERSION),
  path: 'string',
  facets: type.Record('string', CurrentReceiptFacetEntrySchema),
})

/**
 * Preceding (`0.3`) receipt: complete asset ownership with dispositions, no
 * facet integrity and no configuration claims.
 */
const Receipt03FacetEntrySchema = type({
  version: 'string',
  assets: ReceiptAssetSchema.array(),
})

const Receipt03Schema = type({
  version: type.unit(RECEIPT_VERSION_0_3),
  path: 'string',
  facets: type.Record('string', Receipt03FacetEntrySchema),
})

/**
 * Preceding (`0.2`) receipt: owned-file records, no disposition. Every asset
 * is understood as materialized under its authored name.
 */
const Receipt02AssetSchema = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
  files: 'string[]',
})

const Receipt02FacetEntrySchema = type({
  version: 'string',
  assets: Receipt02AssetSchema.array(),
})

const Receipt02Schema = type({
  version: type.unit(RECEIPT_VERSION_0_2),
  path: 'string',
  facets: type.Record('string', Receipt02FacetEntrySchema),
})

/** Legacy (`1`) receipt: identity-only asset tuples, no owned-file records. */
const LegacyReceiptAssetSchema = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
})

const LegacyReceiptFacetEntrySchema = type({
  version: 'string',
  assets: LegacyReceiptAssetSchema.array(),
})

const LegacyReceiptSchema = type({
  version: type.unit(LEGACY_RECEIPT_VERSION),
  path: 'string',
  facets: type.Record('string', LegacyReceiptFacetEntrySchema),
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A current receipt asset record with its owned inner-archive file paths.
 *
 * Built on its own shape, not a lockfile asset type: the receipt is
 * machine-local state with its own schema and its own version axis, and
 * inheriting a lockfile shape made it look like the two evolve together.
 * They do not.
 *
 * `name` is the AUTHORED name, and `files` are authored inner-archive paths;
 * the name on disk is derived by applying `materialization` to them. This is
 * deliberately NOT an {@link AssetIdentity}, whose `name` is effective —
 * handing a receipt asset to an adapter request would address the wrong file
 * for anything aliased, so the two shapes are kept unassignable.
 */
export interface ReceiptAsset {
  scope: Scope
  type: AssetType
  name: string
  /**
   * How this asset was materialized. Only the two arms that write bytes are
   * admissible — an omitted asset is absent from the receipt entirely.
   */
  materialization: MaterializedDisposition
  files: string[]
}

/**
 * One MCP configuration claim: an active declaration this machine
 * successfully reconciled into every selected adapter.
 *
 * The claim is deliberately two things at once. It is keyed deletion
 * authority — the effective identity derived from `name` and
 * `materialization` may be removed when nothing desires it any more — and it
 * is this machine's evidence that the declaration behind `fingerprint` was
 * approved here. Neither may be inferred from the lockfile, which is shared
 * state that a teammate's commit rewrites.
 *
 * What it is NOT is a copy of the declaration. The fingerprint answers "is
 * this the same launch or connection behavior?" without the receipt ever
 * holding a command, its arguments, a URL, or an environment name or value.
 */
export interface ReceiptConfigurationClaim {
  kind: 'mcp-server'
  /** The AUTHORED server name. The effective one derives from `materialization`. */
  name: string
  materialization: MaterializedDisposition
  fingerprint: McpServerFingerprint
}

/**
 * Asset ownership for one facet — the part every readable receipt version can
 * express, and therefore the part every version confers full authority over.
 */
export interface ReceiptAssetOwnership {
  version: string
  assets: ReceiptAsset[]
}

/**
 * A current (`0.4`) facet record: asset ownership, plus the facet integrity
 * that witnessed it, plus the configuration claims reconciled alongside it.
 *
 * `integrity` is what makes an offline proof possible later: declarations
 * live inside the integrity-protected `facet.json` and deliberately not in
 * the lockfile, so "are this facet's claims still about the same
 * declarations?" is answerable without a fetch only by comparing the recorded
 * integrity against the locked one.
 *
 * Extends {@link ReceiptAssetOwnership} rather than restating it, so every
 * consumer that only needs assets accepts a current record unchanged while
 * nothing can read claims off a record that has none.
 */
export interface ReceiptFacetEntry extends ReceiptAssetOwnership {
  integrity: string
  configurations: ReceiptConfigurationClaim[]
}

/**
 * The receipt this machine writes. Always the current version: every earlier
 * format refines into memory on load and the next successful write emits
 * `0.4`, never an intermediate writer format. That is a property of the type
 * rather than of remembering to set a field — `version` admits one value, and
 * {@link writeReceipt} accepts nothing else.
 */
export interface Receipt {
  version: typeof CURRENT_RECEIPT_VERSION
  path: string
  facets: Record<string, ReceiptFacetEntry>
}

/**
 * What a receipt file that LOADED proves, and how much of it.
 *
 * Two arms, because there are exactly two answers and they differ in kind
 * rather than in degree. A `0.4` document witnessed both what this machine
 * put on disk and what it configured. Every earlier document witnessed the
 * files and could not have witnessed configuration, because the concept did
 * not exist when it was written.
 *
 * The distinction is represented rather than flattened, deliberately. A
 * refined pre-`0.4` record carrying `configurations: []` would be
 * indistinguishable from a current record whose facet genuinely reconciled no
 * declarations — and those two states must diverge: the first can prove
 * nothing and forces ordinary resolution, while the second is positive
 * evidence, anchored by `integrity`, that a successful operation left no
 * active configuration behind.
 *
 * Tagged at the document rather than per facet, because that is where the
 * fact lives: version dispatch is exact and refinement is whole-document, so
 * a receipt in which some facets are witnessed and others are not is not a
 * state this system can produce.
 */
export type LoadedReceipt =
  /** Every readable pre-`0.4` document. Full asset authority, no configuration authority. */
  | {
      authority: 'assets-only'
      refinedFrom: PreConfigurationReceiptVersion
      path: string
      facets: Readonly<Record<string, ReceiptAssetOwnership>>
    }
  /** A current document. Asset authority plus witnessed configuration claims. */
  | {
      authority: 'assets-and-configuration'
      path: string
      facets: Readonly<Record<string, ReceiptFacetEntry>>
    }

/**
 * The asset ownership a loaded record proves, whatever configuration
 * authority it carries.
 *
 * Every readable version records assets identically, so asset consumers
 * should not have to discriminate — and must not, because branching would
 * invite one of them to treat a pre-`0.4` record as owning less than it does.
 */
export function assetOwnershipOf(record: LoadedReceipt): Readonly<Record<string, ReceiptAssetOwnership>> {
  return record.facets
}

/**
 * A receipt record rejected during load. Reported — never acted on — while
 * the facet's remaining valid records still load (D6: a corrupted receipt may
 * cause a skipped cleanup; it must never poison the rest of the file).
 *
 * Tagged because the two kinds name different things and are recovered from
 * differently: an asset names a path this machine will now never clean up, a
 * configuration claim names a server entry that reverts to untracked and
 * unapproved. A single shape with an `asset` field holding a server name
 * would read as the former while meaning the latter.
 */
export type InvalidReceiptEntry =
  /**
   * The asset's name or one of its owned file paths failed validation (path
   * traversal, backslashes). Because an invalid path could escape the
   * adapter's storage root, the whole asset record is dropped rather than
   * partially trusted — an unowned or escaping path is never deleted.
   */
  | { kind: 'asset'; facet: string; asset: string; reason: string }
  /**
   * The claim's server name or fingerprint was malformed, or the facet made
   * two contradictory claims about one authored name. Dropping it withdraws
   * both of the things a claim confers: the entry becomes untracked native
   * occupancy, and its declaration needs approval again. Both are the safe
   * direction — nothing is deleted and nothing is assumed consented.
   */
  | { kind: 'configuration'; facet: string; server: string; reason: string }

export type LoadReceiptResult =
  | { ok: true; record: LoadedReceipt; invalidEntries: ReadonlyArray<InvalidReceiptEntry> }
  | { ok: false; reason: 'missing' | 'corrupt' | 'path-mismatch' }

/**
 * Why this machine has no usable account of what it materialized. Derived
 * from the failure arm rather than restated, so the two cannot diverge.
 */
export type ReceiptUnavailableReason = Extract<LoadReceiptResult, { ok: false }>['reason']

/**
 * What this machine can prove it materialized.
 *
 * Two states, because there are only two answers: either a receipt file was
 * read and its validated claims ARE this machine's account of disk, or there
 * is no usable account and the proven ownership set is empty. The reasons an
 * account can be unusable differ in what to tell the user, never in how much
 * ownership they confer — a missing receipt and a corrupt one both prove
 * nothing, and the lockfile cannot stand in for either, because it is shared
 * state that a `git pull` rewrites without touching a single file on disk.
 *
 * The `unavailable` arm carries NO record, deliberately. Every claim in a
 * receipt is a licence to delete, so a state that means "no claims" must not
 * be able to hold any: an empty-by-convention record here would put the
 * whole guarantee on one constructor remembering to leave a field empty.
 * `canonicalProjectPath` is all the arm needs, because the only other use for
 * a loaded record is as the location a commit writes its NEW one to.
 */
export type ProjectReceiptState =
  /** Read from this machine's receipt file, and free to contradict the lockfile. */
  | { kind: 'loaded'; record: LoadedReceipt; invalidEntries: ReadonlyArray<InvalidReceiptEntry> }
  /** No trustworthy local account. Proven ownership is empty by construction. */
  | { kind: 'unavailable'; reason: ReceiptUnavailableReason; projectPath: string }

// ---------------------------------------------------------------------------
// Path computation
// ---------------------------------------------------------------------------

const HASH_LENGTH = 12

/**
 * Compute the receipt file path for a project directory.
 *
 * The filename is `<basename>-<hash>.json` where:
 *   - `<basename>` is the last segment of the project dir (cosmetic)
 *   - `<hash>` is the first 12 hex characters of sha256(realpath)
 *
 * `realpath` is resolved before hashing so symlinked and case-variant
 * spellings of one project converge on one receipt. Two different
 * projects can only collide via SHA-256 truncation (negligible at 12
 * hex = 48 bits); the embedded-path check fails closed regardless.
 */
export function receiptPath(projectDir: string): string {
  const canonical = realpathSync(projectDir)
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, HASH_LENGTH)
  const slug = basename(canonical)
  return join(facetReceiptsDir(), `${slug}-${hash}.json`)
}

/**
 * Resolve the canonical (realpath) project directory. Exported so the
 * caller can pass the same value to both `loadReceipt` and
 * `writeReceipt` without re-resolving.
 */
export function canonicalProjectPath(projectDir: string): string {
  return realpathSync(projectDir)
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load the receipt for a project. Returns the parsed receipt on
 * success, or a structured failure reason:
 *
 *   - `missing`: no receipt file exists (first operation on this project)
 *   - `corrupt`: file exists but is unreadable, unparseable, or fails
 *     schema validation
 *   - `path-mismatch`: the receipt's embedded path does not match the
 *     current project's canonical path (collision, corruption, or the
 *     project was moved)
 *
 * Crafted asset NAMES (path traversal, backslashes) do NOT poison the
 * whole receipt: each invalid entry is extracted into `invalidEntries`
 * (facet, asset, reason) for the caller to report, while every valid
 * entry still loads and is processed normally. The returned receipt's
 * asset lists contain only validated names.
 *
 * Never throws.
 */
export function loadReceipt(projectDir: string): LoadReceiptResult {
  const read = readProjectReceipt(projectDir)
  if (!read.ok) return { ok: false, reason: 'corrupt' }
  if (read.state.kind === 'loaded') {
    return { ok: true, record: read.state.record, invalidEntries: read.state.invalidEntries }
  }
  return { ok: false, reason: read.state.reason }
}

/**
 * The receipt file's exact state, or the fact that it could not be read.
 *
 * Kept apart from {@link ProjectReceiptState} because the two answer
 * different questions about one file. That one asks what this run may DELETE,
 * and a receipt it cannot interpret answers "nothing". This one asks what the
 * commit may WRITE OVER, and a readable but meaningless receipt answers
 * "exactly these bytes".
 */
export type ProjectReceiptFile = { readable: true; state: FileState } | { readable: false; cause: string }

/** Everything one read of the receipt establishes. */
export type ReadProjectReceiptResult =
  | {
      ok: true
      /** The receipt file's location. */
      path: string
      /** The canonical project directory this receipt is keyed by. */
      canonical: string
      file: ProjectReceiptFile
      state: ProjectReceiptState
    }
  | { ok: false; cause: string }

/**
 * Read this machine's receipt once, for both of the things a run needs from
 * it — what it may delete, and what its commit may overwrite.
 *
 * Never throws: an unresolvable project path is the one failure that leaves
 * nothing to report, because without a canonical path there is neither a
 * receipt to interpret nor a location to write one to.
 */
export function readProjectReceipt(projectDir: string): ReadProjectReceiptResult {
  let canonical: string
  let filePath: string
  try {
    canonical = realpathSync(projectDir)
    filePath = receiptPath(projectDir)
  } catch (error) {
    // realpathSync throws when the path doesn't exist or is otherwise
    // unresolvable (dangling symlink, permission denied). Nothing can be
    // witnessed without a canonical path to witness it against.
    return { ok: false, cause: `could not resolve the receipt path: ${errorMessage(error)}` }
  }

  const inspected = inspectFileState(filePath)
  if (!inspected.ok) {
    return {
      ok: true,
      path: filePath,
      canonical,
      file: { readable: false, cause: describeInspectFailure(inspected.failure) },
      // Unreadable proves exactly as much as unparseable: nothing.
      state: { kind: 'unavailable', reason: 'corrupt', projectPath: canonical },
    }
  }

  return {
    ok: true,
    path: filePath,
    canonical,
    file: { readable: true, state: inspected.state },
    state: receiptStateFromFile(inspected.state, canonical),
  }
}

/** What a receipt file's bytes prove about what this machine materialized. */
function receiptStateFromFile(state: FileState, canonical: string): ProjectReceiptState {
  if (state.kind === 'absent') return { kind: 'unavailable', reason: 'missing', projectPath: canonical }

  let parsed: unknown
  try {
    parsed = JSON.parse(decodeFileText(state.contents))
  } catch {
    return { kind: 'unavailable', reason: 'corrupt', projectPath: canonical }
  }

  const dispatched = dispatchReceiptVersion(parsed)
  if (dispatched === null) return { kind: 'unavailable', reason: 'corrupt', projectPath: canonical }

  // Self-identification check: the embedded path must match the
  // project being operated on.
  if (dispatched.path !== canonical) {
    return { kind: 'unavailable', reason: 'path-mismatch', projectPath: canonical }
  }

  // Null-prototype throughout: a receipt facet key is an arbitrary string
  // from a file on disk, and dropping a `__proto__`-named facet here would
  // erase an ownership claim silently — the one outcome D6 rules out, since
  // the assets it covers would then never be deleted OR re-tracked.
  const invalidEntries: InvalidReceiptEntry[] = []

  if (dispatched.authority === 'assets-only') {
    const facets: Record<string, ReceiptAssetOwnership> = ownRecord()
    for (const [facetName, entry] of Object.entries(dispatched.facets)) {
      facets[facetName] = { version: entry.version, assets: validatedAssets(facetName, entry.assets, invalidEntries) }
    }
    return {
      kind: 'loaded',
      record: { authority: 'assets-only', refinedFrom: dispatched.refinedFrom, path: canonical, facets },
      invalidEntries,
    }
  }

  const facets: Record<string, ReceiptFacetEntry> = ownRecord()
  for (const [facetName, entry] of Object.entries(dispatched.facets)) {
    facets[facetName] = {
      version: entry.version,
      integrity: entry.integrity,
      assets: validatedAssets(facetName, entry.assets, invalidEntries),
      configurations: validatedClaims(facetName, entry.configurations, invalidEntries),
    }
  }
  return {
    kind: 'loaded',
    record: { authority: 'assets-and-configuration', path: canonical, facets },
    invalidEntries,
  }
}

/** The raw asset shape produced by version dispatch before path validation. */
interface RawReceiptAsset {
  scope: 'system' | 'user' | 'project'
  type: 'skill' | 'agent' | 'command'
  name: string
  materialization: MaterializedDisposition
  files: ReadonlyArray<string>
}

/** One facet's asset ownership as dispatch produced it. */
interface RawAssetFacet {
  version: string
  assets: ReadonlyArray<RawReceiptAsset>
}

/** One current facet record as dispatch produced it, claims not yet checked. */
interface RawCurrentFacet extends RawAssetFacet {
  integrity: string
  configurations: ReadonlyArray<{
    kind: 'mcp-server'
    name: string
    materialization: MaterializedDisposition
    fingerprint: string
  }>
}

/** What exact version dispatch establishes, before the path check. */
type DispatchedReceipt =
  | {
      authority: 'assets-only'
      refinedFrom: PreConfigurationReceiptVersion
      path: string
      facets: Readonly<Record<string, RawAssetFacet>>
    }
  | { authority: 'assets-and-configuration'; path: string; facets: Readonly<Record<string, RawCurrentFacet>> }

/**
 * Exact version dispatch (design D10), mirroring the lockfile. Any other or
 * absent version is corrupt — the shape is never sniffed to guess a schema.
 *
 * Each earlier version refines losslessly into the current ASSET shape, and
 * none of them gains configuration authority by doing so:
 *
 *   `1`   — identity only. Refined to primary-only ownership, which is exact
 *           rather than a guess: legacy installs could not materialize
 *           companions, so there were none to record.
 *   `0.2` — complete ownership, no disposition. Refined to authored
 *           materialization, the only meaning a pre-disposition receipt could
 *           have had.
 *   `0.3` — complete ownership with dispositions. Nothing to refine.
 *
 * Returns `null` for an unreadable document rather than a reason, because
 * every way this step can fail is the same reason.
 */
function dispatchReceiptVersion(parsed: unknown): DispatchedReceipt | null {
  const observedVersion =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? (parsed as { version?: unknown }).version
      : undefined

  const authored = { kind: 'authored' } as const

  if (observedVersion === CURRENT_RECEIPT_VERSION) {
    const validated = CurrentReceiptSchema(parsed)
    if (validated instanceof type.errors) return null
    return { authority: 'assets-and-configuration', path: validated.path, facets: validated.facets }
  }

  if (observedVersion === RECEIPT_VERSION_0_3) {
    const validated = Receipt03Schema(parsed)
    if (validated instanceof type.errors) return null
    return {
      authority: 'assets-only',
      refinedFrom: RECEIPT_VERSION_0_3,
      path: validated.path,
      facets: validated.facets,
    }
  }

  if (observedVersion === RECEIPT_VERSION_0_2) {
    const validated = Receipt02Schema(parsed)
    if (validated instanceof type.errors) return null
    const facets: Record<string, RawAssetFacet> = ownRecord()
    for (const [name, entry] of Object.entries(validated.facets)) {
      facets[name] = {
        version: entry.version,
        assets: entry.assets.map((a) => ({ ...a, materialization: authored })),
      }
    }
    return { authority: 'assets-only', refinedFrom: RECEIPT_VERSION_0_2, path: validated.path, facets }
  }

  if (observedVersion === LEGACY_RECEIPT_VERSION) {
    const validated = LegacyReceiptSchema(parsed)
    if (validated instanceof type.errors) return null
    const facets: Record<string, RawAssetFacet> = ownRecord()
    for (const [name, entry] of Object.entries(validated.facets)) {
      facets[name] = {
        version: entry.version,
        assets: entry.assets.map((a) => ({
          ...a,
          materialization: authored,
          files: [canonicalPrimaryPath(a.type, a.name)],
        })),
      }
    }
    return { authority: 'assets-only', refinedFrom: LEGACY_RECEIPT_VERSION, path: validated.path, facets }
  }

  return null
}

/**
 * Validate every asset name AND every owned file path — receipt data is
 * untrusted. A crafted name or a path that could traverse outside the
 * adapter's storage drops the whole asset record (reported, never deleted),
 * while the facet's remaining valid entries still load (D6).
 */
function validatedAssets(
  facetName: string,
  assets: ReadonlyArray<RawReceiptAsset>,
  invalidEntries: InvalidReceiptEntry[],
): ReceiptAsset[] {
  const valid: ReceiptAsset[] = []
  for (const asset of assets) {
    const nameCheck = validateAssetName(asset.name)
    if (!nameCheck.ok) {
      invalidEntries.push({ kind: 'asset', facet: facetName, asset: asset.name, reason: nameCheck.reason })
      continue
    }
    let badPath: { path: string; reason: string } | undefined
    for (const p of asset.files) {
      const check = validateAssetName(p)
      if (!check.ok) {
        badPath = { path: p, reason: check.reason }
        break
      }
    }
    if (badPath !== undefined) {
      invalidEntries.push({
        kind: 'asset',
        facet: facetName,
        asset: asset.name,
        reason: `owned path "${badPath.path}" ${badPath.reason}`,
      })
      continue
    }
    valid.push({
      scope: asset.scope,
      type: asset.type,
      name: asset.name,
      materialization: asset.materialization,
      files: [...asset.files],
    })
  }
  return valid
}

/**
 * Validate one facet's configuration claims, dropping and reporting the ones
 * this machine cannot act on.
 *
 * Per-entry containment, exactly as for assets: a claim the file got wrong
 * must not withdraw authority over every other claim in it. Dropping is
 * always the safe direction — a dropped claim deletes nothing and consents to
 * nothing.
 *
 * The server-name grammar and the fingerprint spelling are protocol
 * contracts, so they are checked with the protocol's own predicates rather
 * than re-expressed here. `isMcpServerFingerprint` narrows, which is what
 * turns a `string` read off disk into a fingerprint without a cast.
 *
 * A facet claiming one authored name twice is resolved by what the two claims
 * say. Byte-identical repetition is redundancy and collapses to one claim.
 * Two claims that DISAGREE about the disposition or the declaration are a
 * record contradicting itself about a single server, so neither survives:
 * keeping the first would let file order decide which effective entry this
 * machine believes it owns, and which declaration it believes was approved.
 */
function validatedClaims(
  facetName: string,
  claims: RawCurrentFacet['configurations'],
  invalidEntries: InvalidReceiptEntry[],
): ReceiptConfigurationClaim[] {
  const byName = new Map<string, ReceiptConfigurationClaim>()
  const contradicted = new Set<string>()

  for (const claim of claims) {
    const { fingerprint } = claim
    const nameCheck = validateMcpServerName(claim.name)
    if (!nameCheck.ok) {
      invalidEntries.push({ kind: 'configuration', facet: facetName, server: claim.name, reason: nameCheck.reason })
      continue
    }
    if (!isMcpServerFingerprint(fingerprint)) {
      invalidEntries.push({
        kind: 'configuration',
        facet: facetName,
        server: claim.name,
        reason: `fingerprint "${fingerprint}" is not a sha256 digest`,
      })
      continue
    }
    const candidate: ReceiptConfigurationClaim = {
      kind: 'mcp-server',
      name: claim.name,
      materialization: claim.materialization,
      fingerprint,
    }
    const existing = byName.get(claim.name)
    if (existing === undefined) {
      byName.set(claim.name, candidate)
      continue
    }
    if (sameDisposition(existing.materialization, candidate.materialization) && existing.fingerprint === fingerprint) {
      continue
    }
    contradicted.add(claim.name)
  }

  for (const name of contradicted) {
    byName.delete(name)
    invalidEntries.push({
      kind: 'configuration',
      facet: facetName,
      server: name,
      reason: 'the receipt records two conflicting claims for this server',
    })
  }

  return [...byName.values()]
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a receipt atomically. Creates the receipts directory if needed.
 *
 * The embedded `path` field is always normalized to `canonicalProjectPath(projectDir)`
 * regardless of what the passed `receipt` carries — this ensures the
 * receipt's self-identification matches what `loadReceipt` computes,
 * so a receipt can never round-trip to a spurious `path-mismatch`.
 *
 * Never throws on ENOENT for the parent directory.
 */
export function writeReceipt(projectDir: string, receipt: Receipt): void {
  const dir = facetReceiptsDir()
  mkdirSync(dir, { recursive: true })
  const filePath = receiptPath(projectDir)
  const canonical = canonicalProjectPath(projectDir)
  const normalized: Receipt = { ...receipt, path: canonical }
  atomicWriteFileSync(filePath, jsonFileText(normalized))
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * The disposition a locked asset was materialized under, or `undefined`
 * when it was not materialized at all.
 *
 * Only a `0.3` entry records a disposition; `0.2` predates the concept and
 * refines to authored. `undefined` means the asset is omitted —
 * it belongs in the lockfile, which records the resolved asset SET, but not
 * in the receipt, which records what is on disk.
 */
export function materializedDispositionOf(asset: SupportedLockfileAssetEntry): MaterializedDisposition | undefined {
  const disposition = lockedDispositionOf(asset)
  return isMaterialized(disposition) ? disposition : undefined
}

/**
 * Load this machine's account of what it materialized.
 *
 * A receipt that does not load confers no ownership, and this returns no
 * receipt value at all in that case. Projecting the lockfile here instead
 * would let shared state authorize deletion of files this machine has no
 * evidence it wrote.
 *
 * Never throws: an unresolvable project path is reported as `corrupt`, the
 * same as an unreadable file, because both leave nothing to witness with.
 */
export function resolveProjectReceipt(projectDir: string): ProjectReceiptState {
  const read = readProjectReceipt(projectDir)
  if (read.ok) return read.state
  return { kind: 'unavailable', reason: 'corrupt', projectPath: bestEffortPath(projectDir) }
}

/**
 * The canonical project path a commit writes this run's receipt to.
 *
 * The commit needs the LOCATION and nothing else: the record it writes is
 * built entirely from what this run reconciled, so handing it a previous
 * receipt to build "on top of" would offer it claims it has no business
 * inheriting — including, for a pre-`0.4` record, claims of a shape it cannot
 * even express.
 */
export function receiptProjectPath(state: ProjectReceiptState): string {
  return state.kind === 'loaded' ? state.record.path : state.projectPath
}

/**
 * Best-effort canonical path. An unresolvable project directory is already the
 * `corrupt` case, and `writeReceipt` normalizes the field again before it
 * reaches disk, so the un-canonicalized fallback never persists.
 */
function bestEffortPath(projectDir: string): string {
  try {
    return realpathSync(projectDir)
  } catch {
    return projectDir
  }
}

/**
 * The receipt entry a locked facet entry implies: every asset the lockfile
 * says was materialized, with the paths it says that asset owns.
 *
 * This is a CLAIM derived from shared state, not an observation of this
 * machine, so there is exactly ONE place it is true: recording a facet whose
 * assets this run just wrote from that very entry (`buildUpdatedReceipt`'s
 * `written` arm). Any other caller would be asserting ownership of files it
 * has no evidence for — the deletion authority that this receipt then hands
 * to the next run.
 *
 * Omitted assets are excluded: the lockfile records the resolved SET, the
 * receipt records what is on disk, and an omitted asset was never written.
 *
 * `configurations` arrives separately because the lockfile has nowhere to
 * derive it from — declarations live in the integrity-protected `facet.json`,
 * deliberately not in the lockfile — so the claims can only come from what
 * this run actually reconciled. `integrity` anchors them to the exact
 * resolved facet they were witnessed against.
 */
export function receiptEntryForLockedFacet(
  entry: SupportedLockfileFacet,
  configurations: readonly ReceiptConfigurationClaim[],
): ReceiptFacetEntry {
  const assets: ReceiptAsset[] = []
  for (const asset of entry.assets) {
    const materialization = materializedDispositionOf(asset)
    if (materialization === undefined) continue
    assets.push({
      scope: asset.scope,
      type: asset.type,
      name: asset.name,
      materialization,
      files: ownedPathsForLockedAsset(asset),
    })
  }
  return { version: entry.version, integrity: entry.integrity, assets, configurations: [...configurations] }
}

/**
 * Owned inner-archive paths for a locked asset.
 *
 * Every supported locked asset (`0.2` and `0.3`) carries a non-empty
 * `files[]` array of `{ path, integrity }` — the schema requires it — and
 * the receipt mirrors the paths, never the hashes. There is no
 * primary-only fallback here any more: the only identity-only lockfile
 * shape was the withdrawn `1`, which no longer loads. (Receipt version `1`
 * still refines to primary-only ownership; that is a separate format on a
 * separate axis, handled where receipts are loaded.)
 */
export function ownedPathsForLockedAsset(asset: SupportedLockfileAssetEntry): string[] {
  return asset.files.map((f) => f.path)
}
