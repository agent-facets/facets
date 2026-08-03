## Context

The current manifest accepts `servers` as version strings or `{ image }` references, but the install engine only collects their names and emits `server-warning`. A separate `server.json` schema describes a registry/runtime model that no implementation resolves. Meanwhile, adapters expose only asset CRUD, the lockfile and receipt record only asset tuples, and the three first-party adapters already own the tool-specific storage conventions that MCP configuration must follow.

This change crosses the published protocol, project intent, machine-local ownership, adapter SDK, all first-party adapters, the transactional install engine, the CLI, and user documentation. It must preserve three existing boundaries:

- `facet.json` is integrity-protected authored content; the lockfile need not duplicate every manifest field.
- `facets.json` records durable project intent, while the receipt alone authorizes deletion on one machine.
- Adapters own tool-native files and formats; the engine never edits `.mcp.json`, `opencode.json[c]`, or `.codex/config.toml` directly.

The current archive format is `0.2`, project manifest is `0.1`, lockfile is `0.3`, receipt is `0.3`, and adapter API is `0.1`. These are independent compatibility axes.

ADR-5 is not an implementation prerequisite for this change. The project is retiring Notion ADRs as governing artifacts because OpenSpec changes and permanent specifications, user documentation, and architecture documentation now provide the authoritative record. Archiving the legacy ADR collection is external governance cleanup and SHALL NOT block this change.

## Goals / Non-Goals

**Goals:**

- Define a portable, closed, tagged declaration for project-scoped stdio and Streamable HTTP MCP servers.
- Translate active declarations into every selected adapter while preserving unrelated tool configuration.
- Obtain explicit consent before a new or changed declaration can cause command execution or network access.
- Detect all desired-state declaration collisions and native-config parse conflicts before mutation.
- Track keyed ownership and prior approval in the machine-local receipt, with exact rollback and offline deletion.
- Preserve legacy `0.1` text-asset archive compatibility while rejecting legacy server references.
- Support server-only facets and durable per-facet aliasing or omission without adding `server` to `AssetType`.
- Apply one reconciliation rule to assets and MCP configurations: desired state authorizes writes, while receipt ownership alone authorizes deletion.

**Non-Goals:**

- Running, probing, authenticating to, installing, or resolving MCP servers.
- Supporting headers, credentials, secrets, OAuth, environment-variable substitution, SSE, WebSockets, user/system scope, or adapter-specific policy in the portable declaration.
- Recording concrete server declarations or their dispositions in `facets.lock`.
- Making tool configuration files byte-identical after edits; unrelated semantic values MUST survive, while comment and formatting preservation is adapter-specific and SHOULD be maximized.

## Decisions

### D1. `servers` becomes a closed tagged union

The current `FacetManifestSchema` SHALL define each `servers.<name>` value as exactly one of:

```ts
type McpServerDeclaration =
  | {
      type: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
    }
  | {
      type: 'http'
      url: string
    }
```

Server names SHALL use the current single-segment asset-name grammar so one key is portable across JSON, JSONC, and TOML. `command` SHALL be non-empty; environment names SHALL use a portable ASCII environment-name grammar; values are literal strings; and `url` SHALL be an absolute `http:` or `https:` URL. Optional empty `args` and `env` SHALL be semantically equivalent to omission when declarations are compared.

Declaration objects SHALL reject unknown members. This is an intentional exception to general manifest extension tolerance: silently ignoring an execution-affecting field such as `headers`, `cwd`, or `shell` would make two consumers execute different configurations while both claimed validation success. New portable fields therefore require an explicit schema revision.

The protocol schema and its inferred type SHALL remain the single source of truth. The Adapter SDK SHALL consume that exported type without redeclaring the shape and without introducing a runtime dependency from protocol to adapter.

The current schema's at-least-one-asset constraint SHALL gain a `servers` disjunct so a server-only manifest validates; the legacy `0.1` schema's copy of that constraint SHALL remain unchanged. Archive planning is unaffected because declarations contribute no archive entries.

Alternatives rejected:

- Reusing Claude Code's `.mcp.json` shape would make one adapter's format the protocol.
- Supporting `cwd`, headers, or substitution now would exceed the common safe intersection of the first-party tools.
- Keeping source/ref references would retain a resolver and registry contract that do not exist.

### D2. Project manifest `0.2` records server aliasing and omission

`facets.json` SHALL gain current version `0.2`. Its expanded facet entry SHALL allow:

```json
{
  "source": "1.*",
  "materialization": {
    "servers": {
      "filesystem": {
        "kind": "aliased",
        "as": "project-filesystem"
      }
    }
  }
}
```

The `servers` group SHALL use the same closed alias-or-omit disposition contract as text assets. Absence means materialize under the authored server name. `{ kind: "aliased", as }` changes only the effective project configuration identity; `{ kind: "omitted" }` removes the declaration from the active desired set. Alias targets SHALL use the portable single-segment asset-name grammar.

A server override counts toward the non-empty expanded-entry rule, survives source changes and failed installs, and is pruned only after a successful non-frozen install proves the authored server no longer exists. Frozen mode SHALL report stale intent rather than prune it.

Readers SHALL continue to accept project manifest `0.1`; normal writes SHALL migrate to `0.2` inside the existing tri-write. Frozen mode SHALL read but never migrate `0.1`.

Alternative rejected: storing configuration dispositions in the lockfile would duplicate project intent and force a lockfile change even though the integrity-pinned `facet.json` already contains the declaration.

### D3. Archive and lockfile stay put; receipt advances to `0.4`

The current archive remains `facetVersion: 0.2`. This is an intentional breaking replacement of speculative server references: old version-string and `{ image }` declarations are invalid in both current and legacy manifests. Legacy archive `0.1` remains supported for its text-asset contract. The lockfile remains `0.3`; each facet's existing integrity already commits to the exact embedded `facet.json`, including concrete server declarations.

The machine-local receipt SHALL advance to `0.4`. Each facet entry SHALL retain asset ownership and additionally record its resolved facet integrity plus configuration claims:

```ts
type ReceiptConfigurationClaim = {
  kind: 'mcp-server'
  name: string
  materialization: MaterializedDisposition
  fingerprint: `sha256:${string}`
}
```

`name` is the authored server name. `materialization` is the shared authored-or-aliased disposition type; omitted declarations are unmaterialized and therefore unrepresentable in the receipt. The effective configuration identity is derived from the authored name and disposition, matching asset ownership.

Only active, successfully reconciled declarations appear. The claim is simultaneously keyed deletion authority and evidence that this project previously approved that effective declaration. Approval is derived project-wide by `(kind, effectiveName, fingerprint)`, so adding a second facet that makes an identical effective claim does not re-prompt; a new effective name or changed fingerprint does.

The fingerprint SHALL hash the declaration's canonical semantic encoding independently of its authored or effective name: fixed tagged-union field order, argument order preserved, environment keys sorted, and omitted optional collections normalized to empty. Receipt records SHALL never store command arguments, URLs, or environment values themselves.

Receipt `0.3`, `0.2`, and `1` SHALL remain readable for their asset ownership, but SHALL confer no configuration ownership or approval. The loader SHALL represent that distinction explicitly rather than synthesizing an empty current configuration record and pretending it was witnessed.

### D4. Configuration composition is separate from asset composition

The protocol/engine SHALL introduce configuration identities and plans rather than widening `AssetType`. The only initial identity is `(kind: 'mcp-server', effectiveName)` at project scope.

After applying persisted aliases and omissions, composition SHALL group active claims by effective server name:

- One claim, or multiple claims with the same canonical fingerprint, produces one effective configuration with all claimant facets retained for ownership and reporting.
- Active claims with different fingerprints produce one complete pre-write conflict report naming every claimant and declaration summary.
- Aliasing changes the effective identity before grouping.
- Omitted claims do not participate.

Asset and configuration composition SHALL reuse one generic, deterministic effective-name planning primitive while retaining separate domain types and wrappers. MCP servers SHALL NOT become an `AssetType`. The shared primitive SHALL preserve the existing single-pass alias semantics, exhaustive collision reporting, portable collision keys, and code-unit ordering.

A resolver response SHALL remain a complete disposition set and SHALL be re-planned before acceptance. No resolver may silently choose a winner.

### D5. MCP configuration consent is based on receipt configuration claims, not the lockfile

After resolution, composition, adapter preflight, and read-only native-config preparation succeed, the engine SHALL compare every effective MCP declaration with the receipt's configuration-approval evidence. Only new or changed `(kind, effectiveName, fingerprint)` values require declaration consent. Asset ownership records in the same receipt SHALL confer no MCP configuration approval.

Interactive callers SHALL receive one MCP-configuration-only consent request containing every unapproved declaration, its claimant facets, and the exact command plus arguments and environment assignments, or the exact URL. Configuration already approved at the same effective identity and fingerprint SHALL not prompt again, including after a no-op reproduction.

MCP server preparation SHALL also report every selected adapter where an active effective identity occupies an MCP entry that the receipt's configuration claims do not own. Because preparation already parses each native configuration document, this takeover detection adds no second scan. The MCP configuration request SHALL show those entries in a distinct takeover section, including the adapter name, whether adapter-computed native-rendering equality found an equivalent entry, and the desired declaration.

Approval accepts the complete MCP configuration request. It authorizes declaration materialization plus adoption without rewriting when an untracked native entry is equivalent, or transactional overwrite when it differs. Cancellation returns a structured no-mutation failure because MCP configuration consent occurs before the journal opens.

This request batches only MCP declarations and MCP native-entry takeovers. It SHALL NOT include asset materialization, asset desired-state collision resolution, or asset takeover confirmation. Those retain separate workflows and screens.

Non-interactive callers SHALL fail with the complete MCP declaration and takeover list unless they supplied `--accept-mcp`. The flag SHALL be available on `add`, `install`, and `remove`, because all three may enter the commit pipeline and reconcile remaining facets. Frozen mode SHALL never prompt, but MAY use the pre-supplied flag. No second MCP-override flag SHALL be introduced.

MCP approval SHALL reach receipt configuration claims only through a successful final commit. Declining, failing later, or rolling back writes no MCP approval evidence and does not alter asset ownership evidence.

Alternative rejected: storing MCP approval in `facets.json` would publish a machine's security decision to teammates and would let version control claim that a different machine had approved execution.

### D6. Adapter API `0.2` adds one MCP server capability

The SDK's canonical adapter API SHALL advance to `0.2`. The CLI SHALL retain exact support for `0.1` during a compatibility window: a `0.1` adapter remains usable when desired state contains no MCP server declarations but is MCP-server-unsupported. Concretely, the engine's supported-API set SHALL become exactly `{'0.1', '0.2'}` while every per-adapter check — including npm-metadata versus runtime declaration agreement — SHALL remain exact-token equality; the window widens the acceptance set, never the token semantics. A `0.2` adapter SHALL expose MCP server support as one field:

```ts
mcpServers: false | McpServerCapability
```

This avoids a boolean plus optional methods that can disagree. The capability is deliberately MCP-specific: future project-configuration features SHALL receive independent capabilities whose types encode their own identity, composition, consent, and merge rules. The capability SHALL operate on the complete desired MCP server batch, not one key at a time:

1. A read-only `prepare` operation receives `projectRoot`, the complete desired contribution set, and receipt-authorized previous effective identities. It parses the native file once, preserves unrelated state, detects native parse conflicts, computes adapter-native renderings, compares desired and existing entries semantically, and returns structured per-key outcomes including absent, equivalent, divergent, tracked, and untracked occupancy; the affected native document path(s); and an opaque prepared plan.
2. An `apply` operation consumes that plan, performs one atomic native-file update, and returns `unchanged` or a changed result naming the affected path(s). Adapters SHALL NOT supply inverse operations: before invoking `apply`, the engine SHALL capture byte preimages of every disclosed document and journal a byte-exact restore, so rollback fidelity never depends on adapter code being correct twice or on a semantic inverse reproducing comments and formatting.

Adapter-computed native-rendering equality SHALL be authoritative for no-write adoption. It is semantic rather than byte-based: comments, formatting, and ordering do not differ, while native values that change the effective portable launch or connection behavior do. If an adapter cannot prove equality, it SHALL classify the entry as divergent.

Expected parse, validation, conflict, write, and rollback failures SHALL be discriminated result values. A handled failure inside one adapter operation SHALL leave that adapter's file unchanged. The engine SHALL never inspect the opaque plan or mutate the native file itself.

The first-party targets are:

- Claude Code: project `.mcp.json` and its `mcpServers` map.
- OpenCode: use project `opencode.jsonc` when it exists; otherwise use `opencode.json` when it exists; when neither exists, create `opencode.jsonc`. If both exist, `opencode.jsonc` is canonical. Reconcile the selected file's `mcp` map.
- Codex: trusted-project `.codex/config.toml` and its `mcp_servers` tables. Codex's official MCP documentation confirms project-scoped configuration plus STDIO and Streamable HTTP support.

Each adapter SHALL translate `stdio`/`http` into native terminology, preserve unrelated settings and server keys semantically, and use a syntax-aware edit strategy. A selected `0.1` adapter, or a `0.2` adapter with `mcpServers: false`, SHALL be collected into one unsupported-adapter failure whenever active MCP declarations exist.

Alternative rejected: generic file patches from the engine would leak tool paths, JSONC/TOML behavior, and native schema into the install layer.

### D7. Every configuration is prepared before the first mutation

The commit sequence SHALL become:

1. Acquire the project lock and load `facets.json`, lockfile, and receipt.
2. Resolve and verify every facet, preserving the manifest-format tag.
3. Apply aliases and omissions; compose assets and MCP declarations; fail on every unresolved desired-state collision.
4. Verify every selected adapter can handle the active configuration set.
5. Ask every adapter to prepare its complete native MCP server change read-only; fail on any parse or native planning conflict.
6. Obtain declaration consent and any MCP untracked-destination takeover consent.
7. Open the journal; delete obsolete receipt-owned assets, then write desired assets. During each asset application, detect an occupied effective destination that the receipt does not own and invoke the just-in-time takeover gate. Continue is the default and cancellation rolls back the complete journal.
8. Apply each prepared native MCP server plan.
9. Commit `facets.json`, unchanged-shape `facets.lock`, and receipt `0.4` through the existing tri-write.

Asset takeover detection SHALL reuse the previous-state read already required for no-op detection and rollback; it SHALL NOT add an eager whole-project scan. Interactive callers may continue and take ownership or cancel. Non-interactive callers continue automatically, preserving existing asset behavior. Equivalent content is adopted without writing; different content is overwritten transactionally.

Asset takeover confirmation remains a separate, just-in-time application workflow. No MCP configuration consent response or `--accept-mcp` value SHALL accept an asset takeover on the caller's behalf.

MCP takeover confirmation occurs before the journal opens because adapter preparation has already discovered occupancy and equality without extra I/O. Applying MCP configuration last still minimizes the interval in which a tool watching its config could observe a server before the transaction commits. Before each prepared plan is applied, the engine SHALL journal byte preimages of that plan's disclosed documents. A later adapter, tri-write, or abort failure SHALL replay configuration byte restores and asset inverses in LIFO order.

The removal-only short circuit MAY carry configuration claims forward without fetching when its existing receipt/lockfile agreement proves every remaining claim is still anchored to the same facet integrity. Removed claims are deleted only when no remaining desired or carried-forward claim uses the identity. If that proof is unavailable—especially with a pre-`0.4` receipt—the operation SHALL fall back to ordinary resolution rather than guess.

### D8. Desired state authorizes reconciliation; receipt claims authorize deletion

Assets and MCP configurations SHALL follow one ownership rule: desired project state authorizes reconciliation of every effective identity, including one an untracked native destination already occupies; receipt ownership alone authorizes deletion.

Adapters SHALL preserve every unowned asset or configuration identity that desired state does not name. At a desired effective identity that the receipt does not own:

- An absent destination is created.
- An occupied destination is disclosed through the applicable takeover gate.
- Adapter-computed native-rendering equality adopts equivalent state without rewriting it.
- Divergent state is overwritten after continuation.
- Successful reconciliation records ownership only through the final receipt commit.

At a receipt-owned desired identity, reconciliation proceeds without a takeover warning. For a tracked MCP key, adapters SHALL update portable fields and preserve native fields outside Facets' model where safely possible.

When no desired claim remains, deletion is permitted only if the receipt owned the effective identity. MCP deletion removes the complete server entry. An untracked asset path or server key is never deleted merely because a facet, alias, or lockfile entry disappeared.

Configuration ownership remains project-wide and adapter-agnostic, matching asset ownership. Adding an adapter delegates reconciliation of receipt-owned effective identities without creating another ownership axis.

### D9. Legacy `0.1` archives remain asset-only; old server references are rejected

Legacy archive `0.1` support SHALL remain available for its existing text-asset contract, but `LegacyFacetManifestSchema` SHALL explicitly reject the presence of `servers`. No supported legacy manifest may carry a version-string or `{ image }` server reference.

The current manifest schema SHALL accept only concrete `McpServerDeclaration` values. An invalid current manifest SHALL never fall back to legacy validation. Git and local builds always produce current format.

Registry/archive resolution SHALL retain the archive-format discriminator only as required to select the existing version-specific manifest and asset validation rules. After that boundary, legacy facets contribute no MCP server content and current facets contribute concrete declarations. The engine SHALL NOT define or carry a legacy server-content arm.

The existing `server-warning` stage event, `serverWarnings` install-result field, CLI warning renderer, and associated warn-and-skip tests SHALL be removed. Encountering an old server-reference form is a validation failure, not a successful install with a warning.

Alternative rejected: retaining inert warn-and-skip support would add a permanent server-specific legacy branch for a declaration form that was never used by a published artifact.

### D10. Reporting distinguishes intent changes, drift, and keyed outcomes

`server-warning` and `serverWarnings` SHALL be removed. Current manifests SHALL report structured MCP configuration events and results: consent-required/accepted, added, updated, unchanged, aliased, omitted, removed, conflict, takeover-required/accepted/cancelled, and unsupported adapter. Legacy server-reference forms fail manifest validation and produce no warning event.

Facet outcome classification SHALL count an alias, omission, or declaration change as `updated`, even at the same facet version; rewriting a previously approved declaration solely because native state drifted is `repaired`; and a semantic match is `unchanged`. A semantic match adopted at an untracked destination is `unchanged` plus `takeover-accepted`; a divergent untracked destination that is overwritten is `repaired` plus `takeover-accepted`. Summaries SHALL count text assets and MCP configurations separately so a server-only facet can report meaningful work with zero assets.

Non-interactive failures SHALL render complete commands/URLs, claimant facets, adapter names, and the exact `facets.json` disposition location to stderr without relying on free-form engine messages. Asset and configuration takeover reporting SHALL identify the effective destination without persisting MCP secrets or declarations to logs.

### D11. Documentation changes ship with behavior

The implementation SHALL update:

- `docs/specification/manifest.mdx`, `build.mdx`, `index.mdx`, and `docs/index.mdx` for concrete declarations and server-only facets.
- `docs/specification/project-manifest.mdx` and `materialization.mdx` for manifest `0.2`, MCP aliasing and omission, effective names, and shared collision semantics.
- `docs/specification/commit.mdx`, `lockfile.mdx`, and `terminology.mdx` for configuration composition, consent, receipt `0.4`, keyed ownership, and the unchanged lockfile.
- `docs/specification/publish.mdx` to clarify that declarations travel inside the published manifest but are never independently resolved or published.
- `docs/cli/install.mdx`, `docs/cli/add.mdx`, the remove reference, `docs/guides/install-facets.mdx`, and troubleshooting guidance for prompts, `--accept-mcp`, conflicts, unsupported adapters, frozen behavior, outcomes, and untracked asset/configuration takeover with default continuation, cancellation, non-interactive behavior, and rollback.
- `docs/guides/custom-adapters.mdx` for adapter API `0.2`, the `mcpServers` union and `McpServerCapability`, adapter-computed native-rendering equality, structured occupancy outcomes, and native-file preservation obligations.
- `docs/roadmap/beta.mdx` and `stable.mdx` to mark concrete MCP configuration as shipped rather than reserved.
- Root `README.md` so facets are no longer described as only text assets plus supplementary files.
- A `docs/changelog` entry announcing concrete MCP declarations, consent, and the adapter API `0.2` bump.

The obsolete server-warning documentation pointer requirement SHALL be removed rather than creating a page for behavior that no longer exists.

## Risks / Trade-offs

- **[Facet manifests can trigger commands or outbound connections]** → Closed declarations, integrity verification, complete pre-write display, receipt-backed approval, and explicit non-interactive opt-in make execution authorization unavoidable.
- **[Authors may place a secret in literal `env` despite the contract]** → Documentation SHALL prohibit it; receipts store only fingerprints; CLI output SHALL avoid persisting declarations to logs outside the interactive consent display.
- **[An adapter parser can damage a shared tool config]** → Every adapter prepares read-only, applies one atomic syntax-aware edit, preserves unrelated semantics, and the engine journals byte preimages of every disclosed document, so rollback restores the exact prior bytes.
- **[Desired state can overwrite an untracked native destination]** → Interactive callers are warned at the earliest point available without adding an eager asset scan: MCP takeovers during read-only configuration preparation and asset takeovers just in time during application. Continue is the default; cancellation before MCP mutation needs no rollback, while asset cancellation replays the complete journal. Receipt-owned drift reconciles without warning, and receipt ownership alone authorizes deletion.
- **[A tool may observe config between apply and a later rollback]** → Configuration applies after asset writes and immediately before tri-write. Full isolation from external file watchers is impossible without controlling the tool runtime, which is a non-goal.
- **[Lockfile omission makes frozen server-intent checks occur after archive resolution]** → The lockfile still pins exact manifest bytes by integrity. All MCP checks remain pre-mutation, but unlike asset-disposition gates they may require fetching locked content. This is accepted to avoid duplicating declarations in the lockfile.
- **[Adapter API `0.2` fragments the ecosystem]** → The CLI continues loading `0.1` for text-only projects and reports all adapters that must be upgraded when active MCP configuration requires `0.2` support.
- **[Speculative server references stop loading in every manifest format]** → The break is deliberate and validation fails closed. No published artifact uses the old version-string or `{ image }` forms. Migration requires republishing with a concrete current-format declaration.
- **[TOML/JSONC formatting may change]** → Semantic preservation is mandatory and syntax-aware editing is required; exact formatting preservation is best effort and covered by first-party fixture tests.

## Migration Plan

1. Add the concrete protocol schema/type, server-only validation, project manifest `0.2`, shared generic effective-name planning, MCP aliasing and omission, canonical fingerprinting, and removal of public `server.json` schema/loader exports. Keep legacy `0.1` text-asset compatibility tests and add explicit rejection tests for legacy server references.
2. Add receipt `0.4` exact dispatch and migration, preserving earlier asset authority while granting no configuration authority to older records. Keep lockfile `0.3` unchanged and add tests proving manifest integrity detects declaration drift.
3. Publish Adapter SDK API `0.2`, retain engine compatibility with `0.1`, and implement batch prepare/apply MCP server capability, adapter-native equality, and structured occupancy outcomes in Claude Code, OpenCode, and Codex adapters with format fixtures and rollback tests.
4. Extend composition, frozen checks, removal refinement, journaling, outcome classification, and result types. Add interactive consent, MCP takeover confirmation, `--accept-mcp` to every install-pipeline command, and just-in-time asset takeover handling without an eager asset scan.
5. Replace current warnings, update all documentation listed in D11, and run `bun check` across protocol, adapter SDK, first-party adapters, engine, CLI, docs checks, and end-to-end install scenarios.

An operation-level rollback uses the existing journal and tri-write. A release rollback is fail-closed: an older CLI will reject project manifest `0.2`, receipt `0.4`, and adapter API `0.2` rather than reinterpret them. Before intentionally downgrading the CLI, users must use the new CLI to remove active MCP contributions and collapse any server alias or omission entries, or restore compatible project files from version control.
