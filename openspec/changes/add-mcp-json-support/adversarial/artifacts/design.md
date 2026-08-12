# Design: Concrete MCP Server Declarations (adversarial)

## Context

Today the facet manifest accepts `servers` as `Record<string, string | { image: string }>`
(`ServerReference` in `packages/protocol/src/schemas/facet-manifest.ts`) — a speculative
reference form ("source-mode" version strings, "ref-mode" OCI images) that nothing
consumes. The install engine reduces the map to its keys
(`finalize-facet.ts:63`), emits a `server-warning` stage event
(`resolve-all.ts:105`), and the CLI renders "server installation not yet
supported, skipping" (`install-view.tsx:458`). A standalone `server.json`
artifact model exists in parallel (`schemas/server-manifest.ts`,
`loaders/server.ts` in protocol, `loaders/server.ts` in engine) with no caller
in any pipeline.

Meanwhile the install engine has grown exactly the machinery MCP configuration
needs: a compensating journal with byte-preimage discipline
(`install/journal.ts`, the F14 read guard in `materialize.ts`), machine-local
ownership receipts with exact-version dispatch (`install/receipt.ts`, versions
`1`/`0.2`/`0.3`), global delete-before-write ordering
(`deleteObsoleteAssets`), a genuinely atomic tri-write commit
(`commit/tri-write.ts`), removal-only refinement with zero fetches
(`remove/refine.ts`), and frozen-reproduction gates (`frozen-gates.ts`).

The proposal replaces speculative references with concrete, portable stdio and
Streamable HTTP declarations, materialized through every selected adapter into
tool-owned project configuration (`.mcp.json`, `opencode.json`,
`.codex/config.toml`), under explicit consent, keyed ownership, and the
existing install transaction. Legacy `0.1` archives keep the inert
warn-and-skip behavior.

Constraints inherited from the codebase:

- `facet.json` is byte-covered by the facet integrity hash (it is the first
  entry of the hashed inner tar, `content-hash.ts:43`), so declaration changes
  are already tamper-evident and the lockfile needs no new fields.
- The receipt — not the lockfile — is the sole licence to delete on a machine
  (`ownership.ts:119`); any deletion authority for keyed entries must live
  there and be version-gated.
- The adapter contract is one method per operation with tagged request unions,
  failures as values, and a hard rule that adapters never persist or infer
  ownership (`packages/adapter/src/types.ts`).
- `ADAPTER_API_VERSION = '0.1'` is an exact-equality contract token; the loader
  fails closed on any mismatch.

## Goals / Non-Goals

**Goals:**

- A minimal portable schema for project-scoped stdio and Streamable HTTP MCP
  servers inside `facet.json`, as a tagged union with no representable illegal
  states.
- Adapter-native translation: each selected adapter writes its tool's own
  config document via read/modify/write that preserves unowned content.
- Keyed ownership, conflict detection, durable omission, consent, rollback,
  removal-only installs, and frozen reproduction — all inside the existing
  install transaction and receipt model.
- Fail-before-mutation when any selected adapter cannot safely materialize
  required MCP configuration.
- Server-only facets become valid.
- Removal of the standalone server artifact model.

**Non-Goals:**

- Any MCP runtime, client, proxy, health check, or launch verification.
- Headers, secrets, OAuth, tokens, or a portable env-substitution grammar.
- User-wide or system-wide MCP configuration (project scope only).
- SSE/WebSocket transports, tool-specific policy/enablement passthrough.
- Server name aliasing (deferred; omission is the only escape hatch).
- Registry-resolved or separately published server packages.

## Decisions

### D1. Portable schema: a two-arm tagged union, discriminated by `transport`

Replace `ServerReference` in the **current** facet-manifest schema with:

```ts
const StdioServer = type({
  transport: "'stdio'",
  command: 'string > 0',
  'args?': 'string[]',
  'env?': type.Record('string', 'string'),
})
const HttpServer = type({
  transport: "'http'",
  url: 'string > 0', // MUST parse as http(s) URL; enforced in a narrow
})
const McpServerDefinition = StdioServer.or(HttpServer)
// 'servers?': type.Record('string', McpServerDefinition)
```

- **Explicit discriminator, not field-sniffing.** `.mcp.json`-style formats
  discriminate on which optional fields are present (`command` vs `url`); that
  permits illegal combinations and forces defensive branching. A `transport`
  tag makes every legal shape representable and every illegal one not.
- **`env` is included, static values only.** Many stdio servers are unusable
  without environment configuration. There is no substitution grammar — values
  are literal strings, adapters pass them through verbatim. The secret-leakage
  risk is handled by consent display (env keys and values are shown before
  any write) and by documentation stating secrets MUST NOT be placed in
  `env`; Facets does not scan values. *Alternative considered:* omit `env`
  entirely — rejected because it forces users straight back to manual config
  editing, which is the problem this change exists to solve.
- **`url` only for HTTP.** No headers (per proposal). A narrow rejects
  non-http(s) schemes so a declaration cannot smuggle `file:` or `ws:`.
- Server names (map keys) are validated with a conservative key grammar
  (single-segment, `[A-Za-z0-9][A-Za-z0-9._-]*`) so every target tool can use
  the name verbatim as a JSON/TOML key.
- The **legacy `0.1` schema is not touched**: `LegacyServerReference` stays
  `string | { image }` in `facet-manifest-legacy.ts`, preserving inert
  warn-and-skip for `0.1` archives. Old reference forms in current-format
  manifests fail schema validation with an actionable `ctx.mustBe` message
  pointing at the new shape.

### D2. Minimum-content rule broadens in the current schema only

Constraint 1 in `facet-manifest.ts` adds `hasServers` to the disjunction:
a manifest with only `servers` is valid. The legacy schema's copy of the
constraint is unchanged. No archive-plan change is needed — servers contribute
no files, so `planArchiveEntries` and the three-way set equality in
`validate-archive.ts` are untouched.

### D3. Lockfile unchanged; integrity already covers declarations

The per-facet lockfile `integrity` value hashes the inner tar whose first
entry is `facet.json`, so any change to a `servers` declaration changes the
facet's integrity and is caught by existing verification. MCP contributions
are **derived state** (recomputed from verified `facet.json` on every resolve),
not locked state. Removal-only and frozen paths do not need the lockfile to
describe servers because deletion authority comes from the receipt (D5).
*Alternative considered:* record server declarations in the lockfile for
frozen-install visibility — rejected as a second source of truth for data the
verified archive already carries.

### D4. Adapter SDK: a required `configuration` capability; API token bumps to `0.2`

The `Adapter` interface gains a `configuration` member — a keyed-document
contract deliberately separate from the per-file asset methods:

```ts
interface AdapterConfiguration {
  /** Absolute path(s) of the tool-owned config document(s) for a project. */
  configDocuments(req: { scope: 'project'; projectDir: string }): ConfigDocumentsResult
  /** Read the MCP server entries the adapter recognizes, keyed by name. */
  readMcpServers(req: { scope: 'project'; projectDir: string }): Promise<ReadMcpServersResult>
  /** Read/modify/write: upsert and delete keyed entries, preserve everything else. */
  applyMcpServers(req: {
    scope: 'project'
    projectDir: string
    upserts: Readonly<Record<string, McpServerDefinition>>
    deletes: readonly string[]
  }): Promise<ApplyMcpServersResult>
}
```

All results are discriminated unions with failure-as-values codes
(`io-failed`, `unparseable-document`, `unsupported-scope`).

- **Why not widen `AssetType` with `'server'`:** the asset methods move whole
  files with authored/effective names, companions, and owned path sets. Keyed
  entries inside a shared document have none of that shape; forcing them
  through `InstallAssetRequest` would bolt a third half-fitting variant onto
  every request union and violate the proposal's decision to confine
  asset-methods to text assets.
- **Why `configDocuments` exists:** the engine journals **byte preimages** of
  the named documents before mutation and restores bytes on rollback. This
  gives byte-perfect undo (comments and formatting in JSONC/TOML survive
  rollback) without the engine parsing any tool format, and it extends the
  F14 discipline: if the preimage read fails for any reason other than
  clean absence, the engine fails before mutation. *Alternative considered:*
  semantic undo (re-apply inverse upserts/deletes) — rejected because
  round-tripping comments and unknown sub-fields through a parse/serialize
  cycle is exactly the "copy one tool's format verbatim" trap in reverse.
- **Compatibility:** `ADAPTER_API_VERSION` bumps `'0.1'` → `'0.2'` and
  `configuration` is a **required** member validated by `verifyAdapter`
  (added to `REQUIRED_METHODS`-style checks). The proposal commits to
  changing the compatibility identifier; making the capability required keeps
  the compatibility story one-dimensional (no feature matrix, no
  half-capable adapters) and the loader's existing fail-closed behavior does
  the enforcement. All three first-party adapters ship `0.2` releases in
  lockstep. *Alternative considered:* keep `'0.1'` and feature-detect an
  optional capability — rejected: it creates a capability matrix the CLI must
  explain, and the exact-equality token exists precisely to version contract
  growth.

### D5. Receipt version `0.4`: keyed entries carry deletion authority and consent memory

The machine-local receipt adds a per-facet `mcpServers` record alongside
`assets`:

```ts
interface ReceiptMcpServer {
  scope: 'project'
  name: string                 // the server key
  declarationHash: string      // sha256 of canonical-JSON of the portable definition
}
```

- Exact-version dispatch adds `0.4`; `0.3` (and older) receipts refine
  losslessly with an empty `mcpServers` set — meaning: this machine has no
  deletion authority over keyed entries, exactly the safe default.
  Older CLIs reading a `0.4` receipt fail the version gate and treat the
  receipt as unavailable, which disables deletion rather than corrupting it.
- **Deletion authority:** `buildPreviousOwnership` gains keyed-entry
  ownership; `deleteObsoleteAssets`'s global delete-before-write pass extends
  to keyed entries (`applyMcpServers` with `deletes`), so ownership transfer
  between facets and removal-only installs work identically to text assets.
  An entry present in a tool document but absent from the receipt is
  **unowned** and is never deleted.
- **Consent memory:** `declarationHash` is how "previously approved and
  unchanged" is decided (D6). Keeping it machine-local is deliberate: consent
  is a per-machine, per-human event; a teammate's approval recorded in shared
  state must not silence your prompt. *Alternative considered:* store consent
  in `facets.json` — rejected for exactly that reason.

### D6. Consent is an injected resolver, mirroring the collision-resolver seam

The engine computes the MCP plan (D7) and, before any mutation, partitions
desired entries into *previously approved unchanged* (receipt hash matches),
*new*, and *changed*. If new/changed entries exist:

- Interactive: the engine calls an injected `McpConsentResolver` (same
  dependency-injection seam as `CollisionResolver` in `compose.ts`); the CLI
  renders a full-fidelity display — server name, transport, command + args or
  URL, env keys *and values* — and the user approves or cancels. Cancel maps
  to a `MCP_CONSENT_DECLINED` failure with rollback `not-needed`.
- Non-interactive (no resolver forwarded — CI, `--frozen-lockfile`, non-TTY):
  the install fails with `MCP_CONSENT_REQUIRED` naming each unapproved
  declaration, unless the new explicit opt-in flag `--allow-mcp` is passed,
  which approves the named declarations for this run and records their hashes.
- Reproducing unchanged approved declarations never prompts; frozen installs
  of an unchanged project therefore stay prompt-free.

*Alternative considered:* a `--yes`-style blanket flag — rejected; the opt-in
is scoped to MCP configuration so it cannot be repurposed to bypass future
unrelated gates.

### D7. Planning: keyed composition beside text-asset composition

A new pure planning step runs after `resolveAll` and alongside `compose`:

1. Collect contributions: for each resolved current-format facet, its
   `servers` map (name → definition, canonical-hashed). Legacy facets
   contribute nothing (they keep the warn path, D10).
2. Dedupe/conflict: identical name + identical hash from multiple facets
   collapses to one contribution attributed to all; identical name +
   differing hash is `MCP_SERVER_CONFLICT`, reported with every claimant and
   both definitions, before any mutation. There is no interactive resolution
   in v1 (aliasing is deferred); the escape hatch is omission.
3. Omissions: `facets.json` gains `mcp: { omit?: string[] }` beside the
   existing persisted materialization overrides. Omitted names are excluded
   from the plan and reported as omitted. Omission is shared, durable project
   state — unlike consent, a project-level "we don't want this server"
   decision belongs in versioned state. Stale omissions (naming no declared
   server) are reported and pruned like stale overrides.
4. Adapter preflight: if any planned entry exists and any selected adapter
   lacks a working `configuration` capability, fail `ADAPTER_INCOMPATIBLE`
   (existing preflight seam, extended) before mutation. Under `0.2` this is
   structurally guaranteed for loaded adapters, so the practical case is
   stale installed adapters — which the loader already fails closed.
5. Unowned-collision check: for each adapter, `readMcpServers` is compared
   against the plan. A desired key that exists unowned with a **different**
   value is `MCP_UNOWNED_CONFLICT` (fail before mutation — never overwrite
   the user's own config); an unowned key with an **identical** value is
   adopted (upserted and recorded in the receipt, becoming owned).

### D8. Apply and commit: same transaction, same ordering

- Pass 1 (delete): obsolete keyed entries deleted via `applyMcpServers`
  deletes, globally, before any write — after byte-preimage journal entries
  for each touched document.
- Pass 2 (write): upserts per adapter. Skip-if-identical applies: if
  `readMcpServers` already shows the exact desired entry and the receipt owns
  it, no write and no journal entry.
- Journal entries restore document bytes LIFO on rollback; the existing
  best-effort rollback semantics and `RollbackOutcome` reporting apply
  unchanged.
- Tri-write commit: the receipt gains the `mcpServers` records in the same
  atomic `commitProjectFiles` write; `facets.json` carries omissions; the
  lockfile is untouched (D3). Frozen installs take the existing retain arm
  (receipt-only write).
- Removal-only refinement (`refineRemoval`) extends its witness step: the
  remaining set's keyed entries must be present with matching hashes, else
  `not-applicable` falls back to full resolution.

### D9. Standalone server artifact model is deleted

Remove `schemas/server-manifest.ts`, `loaders/server.ts` (protocol),
`loaders/server.ts` (engine), their `index.ts` re-exports
(`SERVER_MANIFEST_FILE`, `validateServerManifest`, `ServerManifestSchema`,
`ServerManifest`, `loadServerManifest`), and their tests. The
`authoring__servers` spec is retired. Source-mode/ref-mode terminology
disappears with the `ServerReference` comment. Protocol's public API shrinks —
acceptable pre-1.0 and the proposal classifies this change as BREAKING.

### D10. Reporting: warn-and-skip becomes outcome classification

- The `server-warning` stage event and `serverWarnings` result field are
  **retained only for legacy `0.1` facets** (reworded: "legacy facet declares
  servers; not materialized"). For current-format facets they are replaced by:
  - stage events: `mcp-consent-required`, `mcp-configured`
    (`added | updated | unchanged | adopted`), `mcp-omitted`, `mcp-removed`;
  - failure codes: `MCP_SERVER_CONFLICT`, `MCP_UNOWNED_CONFLICT`,
    `MCP_CONSENT_REQUIRED`, `MCP_CONSENT_DECLINED`, plus `ADAPTER_INCOMPATIBLE`
    reuse;
  - a success-summary section listing configured servers per adapter.
- The CLI failure path reuses the 3-line stderr contract (`util/errors.ts`)
  with fix hints ("re-run interactively or pass --allow-mcp", "add the name to
  mcp.omit", "upgrade adapters with facet adapter install").

### D11. First-party adapter targets

| Adapter | Document | Mechanics |
| --- | --- | --- |
| claude-code | `<project>/.mcp.json` | JSON, `mcpServers` key; stdio → `command`/`args`/`env`, http → `type: "http"`/`url` |
| opencode | `<project>/opencode.json` (or `opencode.jsonc` if present) | JSONC-tolerant read/modify/write of the `mcp` key; stdio → `type: "local"` command array + `environment`, http → `type: "remote"`/`url` |
| codex | `<project>/.codex/config.toml` | TOML `mcp_servers.<name>` tables; stdio → `command`/`args`/`env` |

Each adapter maps only the portable fields; it never emits tool-specific
policy/enablement settings. Codex's support for project-scoped config and for
HTTP transports is the weakest of the three and is verified during
implementation; if a transport cannot be expressed natively, `applyMcpServers`
returns a structured failure and the install fails before mutation
(fail-closed, per proposal).

## Risks / Trade-offs

- [Static `env` invites secrets into published facets] → Consent display shows
  values, docs state secrets MUST NOT be declared, and the schema
  documentation frames `env` as launch configuration. No scanning in v1;
  revisit if abuse appears.
- [API token bump `0.1`→`0.2` strands installed adapters until upgraded] →
  Loader already fails closed with actionable repair via
  `facet adapter install`; first-party `0.2` releases ship before the CLI
  release; CLI failure text names the fix.
- [Byte-preimage undo can clobber concurrent external edits to a tool config
  during an install] → Window is milliseconds inside a locked install; the
  project lock already serializes Facets itself; documented as a known limit
  rather than engineered around.
- [JSONC/TOML read-modify-write may not preserve formatting on *write* (only
  rollback is byte-perfect)] → Adapters use format-preserving editors where
  available; where not, the owned-key-only contract still guarantees semantic
  preservation of unowned content, verified by adapter tests with
  comment-bearing fixtures.
- [Adopt-if-identical converts unowned entries to owned, surprising users who
  hand-wrote them] → Reported explicitly as `adopted`; users can remove the
  facet or omit the name to release the claim.
- [Conflict-without-aliasing may block legitimate use of two facets] →
  Deliberate v1 trade-off; omission unblocks installs (at the cost of one
  server), aliasing is the designed follow-up.
- [`--allow-mcp` in CI approves anything new] → It is scoped to MCP only and
  the run report names every approved declaration; teams wanting review
  simply omit the flag and let CI fail on unapproved changes.

## Migration Plan

1. Protocol: new `McpServerDefinition` union, broadened Constraint 1, deletion
   of the server-manifest module, public API updates (one release; BREAKING
   for `servers` users — of which there are none in practice, since
   declarations were inert).
2. Adapter SDK: `configuration` capability, `ADAPTER_API_VERSION = '0.2'`,
   verify/loader updates. Publish SDK, then the three first-party adapters.
3. Engine: receipt `0.4`, MCP planner, consent seam, apply/journal/commit
   extensions, refine/frozen gate extensions, event and failure types.
4. CLI: consent view, `--allow-mcp`, outcome rendering, failure fixes.
5. Docs (Article III): update `docs/specification/manifest.mdx` (§ servers —
   new shape, drop source/ref-mode), `docs/specification/commit.mdx` (§ 367
   out-of-scope note becomes the keyed-configuration contract),
   `docs/specification/publish.mdx` (:77 stored-not-resolved note),
   `docs/specification/materialization.mdx` (new keyed-configuration section),
   `docs/specification/terminology.mdx` (define declaration, keyed entry,
   ownership, omission; remove server-artifact terms), `docs/cli/install.mdx`
   (§ Servers rewritten: consent, outcomes, conflicts, `--allow-mcp`),
   `docs/roadmap/beta.mdx` (mark shipped), `docs/roadmap/stable.mdx`
   (reference update), changelog entry. Rollback strategy: the feature is
   entirely additive at runtime until a facet declares servers; reverting the
   CLI release restores warn-and-skip, and receipts `0.4` degrade safely in
   older CLIs (version gate → no deletion authority).

## Open Questions

- Does Codex support project-scoped `config.toml` and HTTP MCP servers today?
  If not, codex's `applyMcpServers` fails structurally for those cases and
  every install of an MCP-declaring facet with codex selected fails closed —
  correct per proposal, but worth confirming the blast radius before release.
- Should `readMcpServers`' view of "identical" for adopt-if-identical compare
  the portable definition or the tool-native rendering? Proposed: tool-native
  rendering equality as computed by the same adapter, so adoption never
  rewrites bytes it didn't need to.
- Is `opencode.jsonc` vs `opencode.json` precedence stable across OpenCode
  versions? The adapter should follow OpenCode's own resolution order.
