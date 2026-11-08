## Context

The reconciled [proposal](proposal.md) adds one independent user collection alongside existing project collections. The user confirmed `--user`, declaration files under `$FACET_DIR/user/`, and canonical absolute local-source references captured when adding a facet. Delivery remains SDK/adapters first, then the complete engine/CLI lifecycle with text assets and MCP together.

The current separation is already useful:

- Cached registry/git content is shared by name and version under `$FACET_DIR/cache/`, not keyed by project (`packages/engine/src/cache/paths.ts:30`). Sharing verified content does not share installation ownership.
- Projects have independent declarations, lockfiles, native outputs, receipts, and install locks. Receipts and locks live centrally but identify the canonical project path (`packages/engine/src/install/receipt.ts:10`, `packages/engine/src/install/lockfile-guard.ts:22`).
- First-party text adapters contain user destinations and positive user-agent tests, but engine verification assigns every asset project scope (`packages/engine/src/install/verified-asset-plan.ts:133`). There is no independent user lifecycle. MCP planning is project-only.
- Lockfile `0.4` already supplies complete authored MCP inventories and fingerprints. It does not supply ownership or consent. SDK API `0.3` still requires a project root even for user asset requests.

This design extends collection routing, not cache architecture. It serves CLI users managing personal and team dependencies and adapter authors implementing the published contract. Protocol remains pure and Node-compatible; adapters inspect and plan; engine performs every write; CLI owns interaction.

The governing existing contracts are `openspec/specs/installation/spec.md`, `openspec/specs/adapter__assets/spec.md`, `openspec/specs/adapter__mcp-servers/spec.md`, `openspec/specs/adapter__sdk/spec.md`, and `openspec/specs/protocol__schemas/spec.md`. This design identifies their scope-related changes without weakening their verification or transaction guarantees.

## Goals / Non-Goals

**Goals:**

- Manage one user collection from any working directory without changing nearby project state.
- Support skills and all companions, agents, commands, and both portable MCP transports in every first-party adapter, including server-only facets.
- Reuse the existing version-keyed cache, resolution, composition, verification, and filesystem transaction.
- Keep intent, ownership, locking, and approval separate between user and project collections.
- Make native destination selection explicit and preserve unrelated tool configuration.

**Non-Goals:**

- System-wide installation, project declarations that request user-wide outputs, or multiple named user collections.
- Coordination between different `FACET_DIR` roots targeting the same native files. This is explicitly out of scope, not an implementation blocker.
- New external ownership registries, persistent destination reservations, or coordination files outside `FACET_DIR`.
- Automatic movement/synchronization between scopes, universal cross-project discovery, or overriding tool precedence.
- New facet content types, archive formats, MCP fingerprint encodings, credential management, or server execution.

## Decisions

### D1. Keep shared facilities shared; add one collection context

The existing `FACET_DIR` resolver SHALL remain the single source of truth for Facets metadata. Cache and installed adapter packages SHALL continue to be shared. This change SHALL NOT introduce a user-specific cache, add project identity to cache keys, or tie cache eviction to removal from one collection.

The user collection SHALL use:

```text
$FACET_DIR/
  cache/                              # existing shared facet content
  adapters/                           # existing installed adapters
  user/facets.json                     # user declarations
  user/facets.lock                     # user resolved inventory
  receipts/user-<identity-hash>.json    # user ownership and approval
  locks/user-<identity-hash>.lock       # user lifecycle coordination
```

Engine SHALL resolve an explicit target into an immutable operation context: collection identity, state paths, installation scope, adapter environment, and local-source policy. The user identity SHALL be domain-separated from project identity and derived from the canonical user collection root, never cwd. Existing project receipt paths and lock identities SHALL remain compatible.

New CLI local-path arguments use invocation cwd only during add preparation. No other user operation SHALL use cwd to choose its collection. The resolved context SHALL flow through add/install/update/remove preparation and application, plus list/outdated. Helpers SHALL NOT implement user scope by changing `process.cwd()`, changing `FACET_DIR` temporarily, or supplying a fake project root.

User mode SHALL reject a relative `FACET_DIR`, rather than let it select different collections from different directories. A missing collection directory SHALL be identified through its canonical existing ancestor plus normalized suffix; state discovery SHALL NOT create declaration files. A project operation targeting the reserved user collection's state files SHALL refuse rather than reinterpret them as project state.

**Alternative rejected:** independent user cache and pipeline implementations duplicate established behavior. Treating home or `$FACET_DIR/user` as a project chooses incorrect native destinations and source boundaries.

### D2. Extend the SDK with a discriminated target and scope support

Adapter SDK API `0.4` SHALL identify the new contract. Its token is independent of the coincidentally equal lockfile version. Asset install, asset removal, and MCP planning SHALL share an explicit context, conceptually:

```ts
type InstallationTarget =
  | { scope: 'project'; projectRoot: string }
  | { scope: 'user' }

type PlanningContext = {
  target: InstallationTarget
  homeDirectory: string
  environment: Readonly<Record<string, string | undefined>>
}
```

Engine SHALL supply the user's absolute home directory as a location-resolution input, not a materialization destination. It SHALL also supply one read-only environment snapshot. Adapters SHALL exclusively determine tool-specific storage roots and file paths from these inputs and the installation target. The supplied home directory SHALL be authoritative; environment fields supply native config overrides, not a competing home identity. Adapters SHALL use these inputs rather than re-read ambient cwd/home/config overrides independently during the run. The environment snapshot SHALL NOT be persisted or logged wholesale. Tool-specific path rules remain adapter responsibilities, not engine conditionals. Each enabled capability SHALL declare `locationEnvironment`, the environment-variable names it consults during destination resolution; an empty list is valid. Engine SHALL snapshot the union of these declared inputs once and supply only the applicable values to each capability. This declaration SHALL NOT confer ownership over a referenced configuration layer.

Each enabled capability SHALL declare a non-empty supported-scope set. `false` remains a valid declaration for a capability the adapter does not provide; it is not an SDK incompatibility. When the selected operation has active content or owned cleanup requiring a capability/scope, preflight SHALL reject every unsupported selected adapter before mutation. Unused capabilities SHALL NOT be invoked: a text-only operation with no owned MCP cleanup does not require MCP support. Capability eligibility SHALL be symmetric: an adapter declaring `assets: false` SHALL remain selectable for an MCP-only operation when its MCP capability supports the requested scope and no active text asset or owned asset cleanup requires asset planning. Active text assets or owned asset cleanup SHALL still require asset support. First-party materializers SHALL support project and user; system installation remains unsupported with a structured failure for invalid/direct requests. Unsupported requested scopes SHALL produce `ADAPTER_SCOPE_UNSUPPORTED`, identifying the requested scope and every offending adapter/capability with its declared scopes.

Requests retain their tagged content shapes and caller-supplied ownership. Plans retain exact expected states, unchanged/absent outcomes, bounded mutations, and MCP document disclosure. Asset plans SHALL additionally disclose their stable storage root, including on equivalent or absent outcomes. The root SHALL be independent of the asset's effective name for a given adapter, target, and asset type. MCP plans already disclose the complete candidate document set, including absent and unchanged documents. These location facts support D4 without adding a second mandatory target-introspection operation.

Expected unsupported-scope, invalid-target, filesystem-inspection, and native-format failures SHALL remain returned structured values. Adapters SHALL remain free of writes, network calls, and subprocesses. SDK declarations SHALL remain self-contained, with no engine dependency or protocol runtime graph imported through the MCP declaration type.

`defineAdapter` SHALL return `Validated<Adapter>`: `{ ok: true; data: Adapter }` or `{ ok: false; errors: ValidationError[] }`. Invalid definitions, including malformed untyped inputs and incomplete or invalid capability declarations, SHALL return field-addressed validation errors rather than throw. Only completely unknown, unhandleable internal programming errors MAY throw; expected validation failures SHALL NOT be reclassified as such errors. Callers SHALL discriminate the result or propagate it explicitly, without unchecked `data` access or a throwing unwrap helper.

First-party entry points SHALL retain `export default defineAdapter(...)`, exporting the validation result. Bundle verification SHALL validate that result envelope, report factory failures as structured definition errors, and fully verify a successful `data` payload, including exact API compatibility, package/runtime agreement, and complete capability declarations, before activating it. A successful envelope SHALL NOT substitute for those checks. Manually constructed API `0.4` adapter objects SHALL remain accepted under the same verification; this alternative export form SHALL NOT admit older API contracts. Build and install pipelines SHALL receive only successfully verified `Adapter` objects, never unexamined factory results.

**Alternatives rejected:** an optional project root permits malformed project requests. Scope inferred from environment or missing files is unsafe. A mandatory discovery API duplicates information available from read-only plans; mutation paths alone are insufficient because a no-op has no mutations.

### D3. Project installation scope onto verified content; retain current portable formats

The user manifest SHALL reuse manifest `0.2` and its existing declaration/alias/omit grammar. It SHALL remain user-editable and comment-preserving. Its lockfile SHALL remain installer-generated `0.4`. No facet author opt-in or republishing is required.

Verification SHALL establish the same authored content inventory in both scopes. After verification, materialization SHALL assign the selected collection scope to text assets before composition, collision handling, and lockfile construction. User lockfile assets SHALL record `scope: 'user'`; project assets SHALL retain `scope: 'project'`. The `scope` field describes installation scope, not a publisher-selected archive property. Authored names, archive paths, file hashes, facet integrity, and companions remain unchanged.

The lifecycle SHALL reject asset scopes inconsistent with the selected collection before using locked or receipt data for placement or cleanup. Frozen mode SHALL report that drift before fetching content. Ordinary recovery SHALL regenerate a target-consistent lockfile rather than silently turn a foreign-scope entry into deletion authority. Generic protocol readers SHALL retain their published scope vocabulary; collection consistency is an additional contextual check. A contextual mismatch SHALL produce `LOCKFILE_SCOPE_MISMATCH`, carrying the collection scope and offending facet/asset scopes.

MCP materialization planners SHALL receive an explicit scope, with scope-separated effective identities. Existing project-only helper calls SHALL retain compatible project behavior; engine calls SHALL always identify their target. Engine indexes spanning collections additionally require collection identity, since two projects share the same scope.

`deriveLockedMcpInventory(lockfile)` SHALL keep its public signature and collection-relative result. It returns names, fingerprints, and provenance, not a filesystem destination or installation authority (`packages/protocol/src/materialization/locked-inventory.ts:55`). Deriving inventory does not require a home directory or ambient scope.

Server records SHALL remain `{ name, fingerprint, materialization }`. Explicit empty inventories, omitted records, exact version dispatch, extension preservation, legacy `inventory-unavailable`, verified migration, and inventory-versus-content checks SHALL retain their current meaning. Fingerprints remain `facets:mcp-server:v1`; scope SHALL NOT enter their encoding.

**Alternative rejected:** adding scope to every server record or fingerprint introduces a competing format without new information: the containing collection supplies scope. Reusing cache content does not justify reusing another collection's receipt or approval.

### D4. Use one receipt format with user-target bindings

Both collections SHALL use one current receipt `0.5` writer with a tagged `collection` identity distinguishing project and user roots. User receipts SHALL require native-location bindings; project receipts SHALL retain existing adapter-agnostic authority without fabricated historical bindings. Existing project receipt paths and lock identities SHALL remain unchanged. Legacy receipt versions SHALL continue to dispatch exactly and refine as project receipts, preserving their existing asset-only versus asset-and-configuration authority. They SHALL NOT be interpreted as user receipts or gain approval through migration. The next successful receipt write uses `0.5`; no eager rewrite occurs merely on upgrade or discovery.

The new fields are necessary because existing receipts identify a project path and have no user-target binding. This justifies a machine-local schema change; it does not justify changing lockfile `0.4`.

User bindings SHALL record the materializing adapter names, canonical asset storage roots by asset type, and complete canonical MCP candidate-document sets. They SHALL NOT record declaration bodies, environment snapshots, raw deletion instructions, or adapter-encoded content hashes. Locations come from validated plan disclosure, not a second engine implementation of each tool's layout. Cleanup still goes through adapter plans for validated semantic identities.

The receipt SHALL retain one semantic facet inventory, not a separate version/companion history per adapter. To make that inventory truthful, a user mutation SHALL include every previously bound materializing adapter while it has recorded claims. If one is unavailable or omitted, the operation SHALL fail without mutation and identify the adapter to restore. Adding an adapter is allowed: the complete desired collection SHALL reconcile through the existing bound adapters and the new adapter together. The new adapter receives no historical deletion authority from another adapter's location binding; its destinations are untracked and require normal adoption disclosure and MCP approval before recording its binding.

Preparation SHALL produce a candidate read-only plan using the selected collection's recorded ownership, or empty ownership for an unbound adapter. Engine SHALL validate the disclosed canonical locations against the receipt before presenting approval or applying the plan. A mismatch SHALL discard the plan and fail without mutation. No preliminary empty-ownership probe is required. Any replanning required by the existing transaction flow SHALL repeat the binding check.

An existing binding resolving to a different physical root or candidate set SHALL stop before approval or mutation. Engine SHALL NOT silently reinterpret the old receipt at the new location or overwrite it while abandoning old ownership. Recovery is to restore the previous location/compatible adapter, remove the old materializations, then reinstall with the new location. Empty collections can establish fresh bindings.

This is deliberately conservative. It permits normal adapter addition but requires an adapter needed for cleanup to remain available; it avoids per-adapter history, partial uninstall semantics, and new relocation commands. Missing or corrupt receipts still witness nothing, and no locked fingerprint or native-file scan SHALL reconstruct that authority.

**Alternatives rejected:** reusing the project receipt unchanged invents a project identity and permits environment-driven authority redirection. Recording per-adapter historical inventories is unnecessary when user mutations reconcile the full bound set. A fingerprint of the entire environment would react to irrelevant changes and risk persisting secret-bearing inputs.

### D5. Persist local-source meaning at add time

`facet add --user ./my-facet` SHALL interpret the argument relative to invocation cwd, resolve its canonical absolute directory, validate it as a facet source, and persist that absolute path in declaration intent and resolved provenance. Existing materialization overrides SHALL survive normalization. Later user commands SHALL resolve that stored path independently of cwd.

A leading `~/` in a user add argument, including after source-prefix parsing, SHALL expand against the supplied home directory before canonicalization. The stored source SHALL still be absolute. Persisted `~/` references SHALL be rejected alongside other relative user references. This change SHALL NOT alter project-scope tilde handling or containment.

User-local sources MAY be explicitly selected outside `$FACET_DIR/user`. The selected facet directory remains the boundary for authored files and companions; source traversal and symlink escapes SHALL retain existing build/archive checks. Persisted relative user references SHALL be rejected with guidance to re-add or provide an absolute source, not silently given a new base. Retargeting a persisted canonical source through a symlink SHALL be reported as source identity drift.

Project-local sources SHALL retain project-tree containment. Local sources remain mutable and trust-by-path; frozen reproduction SHALL rebuild and compare locked integrity. These absolute references are machine-specific, and docs SHALL recommend registry/git sources when users want to reproduce the collection elsewhere.

**Alternatives rejected:** interpreting stored references against each cwd breaks management from anywhere. Resolving new CLI arguments against the state directory is surprising. Requiring users to copy every local facet under Facets state adds no content-safety benefit.

### D6. Reuse native planners at explicitly selected user locations

First-party adapters SHALL retain their project destinations and resolve user destinations separately. The default user layout is:

- **Claude Code:** the text root is `CLAUDE_CONFIG_DIR` when set, otherwise `~/.claude`; skills, agents, and commands retain their existing subdirectories. User MCP is the top-level `mcpServers` map in `<CLAUDE_CONFIG_DIR>/.claude.json` when the override is set, otherwise `~/.claude.json`. Explicitly setting the override to `~/.claude` therefore selects `~/.claude/.claude.json`, not `~/.claude.json`.
- **Codex:** skills/companions under `~/.agents/skills/<name>/`, agents under the Codex home `agents/`, commands under its `prompts/`, and MCP under `mcp_servers` in its `config.toml`. Codex home defaults to `~/.codex` and honors supported `CODEX_HOME` behavior; it does not relocate the separate `.agents` skill tree.
- **OpenCode:** skills, agents, and commands under `$XDG_CONFIG_HOME/opencode`, otherwise `~/.config/opencode`; user MCP in that directory's `opencode.json(c)` documents.

Home resolution SHALL work on supported platforms, including Windows. Config-root overrides used for persistent user placement SHALL be absolute. Malformed or unsupported layouts SHALL fail before mutation; the adapter SHALL NOT silently ignore an override and write a guessed default. Native-layout evidence gaps are explicitly tracked in Verification.

Claude reconciliation SHALL edit only the top-level user server map. It SHALL preserve `projects`, local-scoped servers, sign-in state, and unrelated settings, and SHALL NOT grant Claude's own project trust. The strict JSON parser and syntax-aware editor remain appropriate. A concurrency failure involving the Claude user-state file SHALL suggest retrying after closing Claude Code; it SHALL NOT retry by overwriting the newer document.

Codex reconciliation SHALL reuse the syntax-preserving TOML planner and preserve trust/profile settings and unrelated tables. The current adapter's `.agents/commands` mapping is not established by the upstream custom-command documentation. For user scope, the documented native mechanism is top-level Markdown custom prompts under Codex home, invoked as `/prompts:<name>`. It is deprecated but documented as supported. This design uses that mechanism without inventing an asset type, changing authored command paths, moving untracked files, or silently translating commands into skills. The existing project command mapping remains legacy compatibility behavior, not a newly asserted native Codex capability. Repairing that mapping is separate work; this change SHALL NOT silently redirect project commands into user prompts or translate them into skills. User-command conformance SHALL verify the documented prompt location.

Both project and user planners SHALL share a V2-aware reader/writer that recognizes native `mcp.servers` and supported legacy flat entries. It SHALL apply documented native-over-legacy normalization and preserve unrelated MCP controls. Control members SHALL NOT be mistaken for server names. New documents in either scope SHALL use `mcp.servers`; existing valid legacy documents SHALL remain supported without a whole-document migration. Ambiguous mixed shapes SHALL fail closed.

Within the selected filesystem scope, OpenCode SHALL inspect/disclose its complete supported candidate set. It SHALL select the highest-precedence existing server map, otherwise the highest-precedence existing document, otherwise the default JSONC document, subject to a verified native ordering. Equivalent state remains a no-write result. Obsolete owned names SHALL be removed from every managed representation/layer defining them so a shadowed copy is not promoted. User planning SHALL NOT clean project/ancestor/custom/inline layers; project planning SHALL NOT clean user fallbacks. Tool precedence never becomes cross-scope ownership. `OPENCODE_CONFIG` and `OPENCODE_CONFIG_DIR` SHALL NOT be treated as alternative destinations for the user collection. Its write target remains the canonical global configuration directory. These custom layers SHALL NOT grant ownership or be modified by this operation. Their exact runtime precedence remains a compatibility question until verified against V2 evidence.

All adapters SHALL retain semantic native equality, literal-value/interpolation checks, exact preimages, and syntax-preserving edits. Safe native extensions MAY survive tracked updates only when they do not alter portable launch/connection behavior. Planners SHALL NOT launch, install, probe, or authenticate a server, and diagnostics SHALL NOT dump unrelated native configuration.

Sources used for native behavior are the [Claude MCP scope reference](https://code.claude.com/docs/en/mcp#mcp-installation-scopes), [Claude environment reference](https://code.claude.com/docs/en/env-vars), [Claude dev-container documentation](https://code.claude.com/docs/en/devcontainer#persist-authentication-and-settings-across-rebuilds), [Codex configuration](https://developers.openai.com/codex/config-file/config-basic), [Codex skills](https://developers.openai.com/codex/skills), [Codex custom prompts](https://developers.openai.com/codex/custom-prompts), and OpenCode's [V2 configuration](https://opencode.ai/v2/docs/config), [V2 MCP](https://opencode.ai/v2/docs/mcp-servers), and [migration compatibility](https://opencode.ai/v2/docs/migrate-v1) guides. V1 documentation and the unversioned OpenCode schema SHALL NOT establish V2 field semantics.

**Alternatives rejected:** substituting home for project root produces incorrect Claude/OpenCode paths. Invoking native tool CLIs would bypass exact-transition planning and restoration. Trusting existing adapter directory conventions alone is not evidence that a target tool consumes every user artifact.

### D7. Reuse collection locking, preflight, and the transaction

Every user mutation SHALL acquire the same user-collection lock before reading mutable collection state, regardless of cwd. Project operations retain their independent locks. No machine-wide lock SHALL serialize ordinary unrelated project installations.

The existing pipeline SHALL be parameterized rather than duplicated:

1. Resolve target and acquire its collection lock; load only that collection's declarations, locked inventory, and receipt.
2. Validate required adapters, local-source policy, collection scope, and frozen pre-fetch gates.
3. Resolve and verify the complete desired set, then compose its materialization choices and collisions.
4. Prepare read-only adapter plans; validate target bindings, actual destination overlap, native parseability, and ownership-based takeover/consent before applying changes.
5. Apply bounded exact transitions and commit declaration, lockfile, and receipt state through the existing transaction. Handled failures SHALL restore changed endpoints under its current non-clobbering rollback rules.

Asset-name collision detection SHALL run independently within the selected collection, reusing existing project-scope effective-name, namespace, name-normalization, and alias/omit rules. Two skills with the same effective name SHALL collide within the user collection or within one project collection. A user `skill-foo` and project `skill-foo` SHALL be allowed to coexist. Facets SHALL NOT combine project and user inventories for name-collision detection or resolve cross-collection shadowing; each harness determines its own precedence.

Physical aliasing is not semantic shadowing: known project/user targets resolving to the same file or storage root SHALL be rejected as an unsupported layout, including a project rooted at home or a project tool directory redirected to its user directory. First-party location helpers SHALL check the two scope mappings using the supplied home/config context; engine SHALL validate disclosed canonical destinations and collection-state path separation. This is a path-safety check, not cross-root ownership discovery or a new persistent reservation system.

MCP approval SHALL come from this collection's matching machine-local claims or explicit approval for this operation. `--accept-mcp` SHALL NOT imply asset takeover approval. Frozen/non-interactive operations SHALL NOT prompt, and fingerprints from a shared cache or lockfile SHALL NOT substitute for approval or verified declarations.

The existing removal fast path SHALL retain its `0.4` complete-inventory and local-witness conditions, with user target/binding agreement added. Otherwise removal falls back to verified resolution of remaining facets. Removing everything SHALL NOT fetch removed content, but still requires ownership and the adapters needed for cleanup. Unknown legacy inventory SHALL NOT become an invented empty inventory.

Normal user commits SHALL write manifest, lockfile, and receipt together. Frozen mode SHALL leave manifest and lockfile byte-identical and retain the existing reported best-effort receipt-persistence behavior: unpersisted ownership/approval is not claimed. There are no new persistent destination reservations whose correctness depends on that receipt write. Existing exact-state checks still protect against external edits to shared native documents.

Missing tool directories SHALL be created only through the transaction's bounded directory handling, not adapter `mkdir` calls. Its current rule permits a missing boundary when its parent exists (`packages/engine/src/fs/directories.ts:177`); missing/unusable outer ancestors SHALL produce actionable failures rather than broadening the write boundary to home.

**Alternatives rejected:** separate user locks per cwd defeat user collection identity. A second user transaction duplicates verification and restoration. External coordination for multiple `FACET_DIR` roots is unrelated to this change and SHALL NOT be added.

### D8. Keep CLI behavior explicit and read-only discovery read-only

`--user` SHALL be a command-specific option on add/install/update/remove/list/outdated, including the `rm` alias. It SHALL NOT change authoring commands, adapter management, or self-update. Omitting it SHALL retain project behavior; no missing-manifest fallback is permitted.

The user-facing forms include `facet add --user cowsay`, `facet install --user --frozen-lockfile --accept-mcp`, `facet update --user --dry-run`, and `facet outdated --user --json`. Existing flags retain their applicable behavior; this feature does not invent new preview modes. Shared option constants and one engine target resolver SHALL prevent individual commands from implementing conflicting scope rules. Outdated remains update discovery with dry-run forced on (`packages/cli/src/commands/outdated/index.ts:53`).

The first successful add SHALL create user declarations only at commit. With no user manifest, list/outdated SHALL report an empty collection without initialization; install/update/remove SHALL report missing collection state and show the scoped add command. An existing empty manifest remains valid. Malformed state SHALL retain the command's existing failure/warning semantics rather than being silently treated as absent.

Human output, collision/takeover screens, MCP consent, and recovery commands SHALL identify user versus project scope. Existing update/outdated JSON SHALL carry structured scope information without a prose banner on stdout. List SHALL use a collection-aware engine read surface rather than grow new CLI-local filesystem business logic. Discovery/dry-run SHALL NOT initialize state, migrate receipts, fetch facet content merely to inspect versions, or write native output. In human-readable mode, `--verbose` SHALL report each participating adapter's resolved storage roots and MCP document paths on stderr, without exposing unrelated configuration or environment snapshots. JSON mode SHALL suppress verbose diagnostics and preserve the existing single-document stdout and empty-stderr behavior. User MCP consent SHALL explain that the configuration applies across projects opened by the selected tool, subject to native overrides and precedence. Plain `facet list` SHALL remain project-only and SHALL NOT discover or advertise the user collection implicitly.

**Alternatives rejected:** a duplicate `facet user ...` command tree fragments existing semantics. A global flag would accidentally apply to unrelated commands. Implicit targeting lets an incorrect working directory become a user-wide write.

## Risks / Trade-offs

- **User config carries unrelated and potentially sensitive state** → Narrow native-map edits, explicit scope/consent, no whole-document logging, exact preimages, and byte-exact restoration.
- **Native roots move through environment or symlink changes** → Compare recorded canonical bindings; refuse authority transfer and provide restore/remove/reinstall recovery.
- **One semantic receipt cannot describe different adapter histories** → Require the previously bound materializers for user mutations; support addition through full reconciliation rather than introduce historical per-adapter versions.
- **Native configuration evolves independently** → Pin supported versions/fixtures and fail closed on unestablished layouts. Complete the native-layout checks in Verification before shipping the affected branches.
- **Codex custom prompts are deprecated** → Document the current invocation and verify consumption against the supported Codex release; do not claim `.agents/commands` works without evidence.
- **Absolute local references do not travel between machines** → Document that trade-off and recommend registry/git for portable collections; never copy machine-local receipts as portable state.
- **Adapter API replacement requires reinstalls** → Publish compatible adapters first, retain exact compatibility diagnostics, and test both old/new CLI selection directions.
- **Receipt `0.5` is not understood by older CLIs** → Preserve exact legacy readers in the upgraded CLI, migrate only on successful writes, and document that downgrades may lose cleanup/approval authority. Never relabel a new receipt as an old version.

## Migration Plan

### Delivery 1: SDK/protocol/adapter foundation

1. Publish the explicit target context, scope declarations, location disclosure, scoped protocol planning, and API `0.4`. Preserve the archive, manifest, and lockfile formats and existing project behavior.
2. Implement all first-party user planners together, including companions and both MCP transports. Update project engine call sites for the new SDK, without exposing incomplete user lifecycle commands. Migrate factory-result consumers, bundle verification, first-party distribution/conformance tests, and build/install fixtures together so every success is checked and every definition failure remains structured data. The shared OpenCode V2-aware reader/writer SHALL be used at both scopes in this delivery.
3. Follow `scripts/release/README.md:61`: publish any required protocol exports, then the SDK and explicit changesets for every first-party adapter, then the requiring CLI in a separate release cycle after package metadata confirms compatible versions. Do not align independent package versions or manipulate npm dist-tags for compatibility.
4. Publish the corresponding SDK/reference documentation, including the factory result, default-export forms, and explicit non-throwing result handling. Old compatibility-aware CLIs keep selecting compatible `0.3` releases; the upgraded CLI requires `0.4` and gives actionable reinstall guidance. Exact incompatible requests SHALL fail before replacing a working adapter. No dual-contract shim is promised.

### Delivery 2: Complete user lifecycle

1. Add target routing, user state/receipt/lock handling, stable local sources, target-binding checks, and all six command surfaces.
2. Preserve existing project manifests, lockfiles, and outputs. Project receipts SHALL migrate lazily to `0.5` on successful receipt writes, retaining only established authority. User state starts independently; no project content or consent is migrated into it automatically.
3. Ship only after the complete text/companion/MCP lifecycle and scope isolation are verified. There is no text-only interim feature.

**Rollback:** Operation failures use the existing filesystem transaction. A product downgrade SHALL NOT rewrite receipt version tags or delete native outputs automatically. Older compatibility-aware CLIs can select compatible `0.3` adapter releases, but SHALL NOT be assumed to understand receipt `0.5`; loss of receipt authority can require fresh disclosure and approval. Older CLIs do not automatically discover the user collection from unrelated project directories and cannot perform its user lifecycle. Retain a compatible CLI and adapters to remove user materializations before downgrade. Deleting a receipt or user state directory alone is not an uninstall.

A user previously approximating user installation with a project rooted at home SHALL remove its receipt-owned materializations using the compatible pre-upgrade CLI before adopting `--user`. The upgraded CLI SHALL retain the HOME-as-project refusal and explain this migration requirement. This change SHALL NOT add conditional dual ownership or cross-collection locking to preserve that workaround.

### Verification

The shared adapter conformance matrix SHALL cover both scopes with mandatory native fixtures for every first-party adapter. Replace blanket home-write prohibitions with scope-specific assertions; do not weaken read-only planning, exact-preimage, disclosure, or no-execution checks. Cover skills with binary companions, all asset types, alias/omit, owned-only cleanup, equivalent no-ops, malformed config, native extension preservation, interpolation, and layered shadow removal.

Factory and consumer regressions SHALL cover valid and invalid definitions, malformed untyped inputs, successful and failed result exports, malformed result envelopes, and manually constructed API `0.4` adapters. A successful envelope with an invalid or incompatible payload SHALL fail verification without invoking an adapter contract method or replacing an existing installation. SDK declarations and first-party distribution tests SHALL exercise the result-returning export contract, and build/install tests SHALL prove that only successfully verified adapters reach the pipelines.

Engine/CLI coverage SHALL include first add without a project; user commands from unrelated directories; shared cached versions with independent project/user pins; independent approvals and removal; server-only facets; canonical local paths; missing/corrupt receipts; bound-adapter addition/removal failures; target drift and physical alias rejection; simultaneous operations on the same user collection; normal/frozen/removal legacy behavior; and rollback failures at native/state endpoints. Preview/JSON tests SHALL prove no extra writes or stdout banners.

Tests SHALL demonstrate equivalent within-collection asset-collision handling in project and user scopes, including alias/omit resolution, and successful same-name user/project coexistence without cross-collection name-collision errors.

Verify that supported Claude versions accept a newly created minimal user-state document containing only `mcpServers`. If not, absence SHALL produce a structured native-state failure directing the user to initialize Claude Code. Malformed existing documents SHALL NOT be treated as absent.

Establish OpenCode V2's same-directory JSON/JSONC ordering and the runtime precedence of custom/inline layers. The user collection's canonical write boundary is fixed regardless; unverified precedence SHALL NOT be asserted as fact.

Pin Codex versions that consume the documented custom-prompt location, including behavior under `CODEX_HOME`.

Use authoritative references and isolated fixtures. An unestablished layout SHALL fail before mutation rather than guess a destination or omit content. Project tilde expansion, project Codex command repair, implicit cross-collection discovery, and cross-`FACET_DIR` coordination remain outside this change.

Run affected unit and distribution/e2e suites, protocol's Node-only checks, docs validation, and `bun check` during implementation. Tests SHALL use isolated homes and restore environment overrides; tests MUST NOT touch real user configuration. This planning artifact does not claim implementation checks have passed.

### Documentation alignment

Existing documentation was checked against the current implementation. It currently describes project-only installation and explicitly forbids user-wide native configuration. Updates SHALL ship with the surface they document:

- **Foundation:** `docs/reference/adapter-sdk.mdx` and `docs/guides/custom-adapters.mdx` SHALL describe the target union, capability scopes, plan location disclosure, and SDK migration. `docs/reference/lockfile-inventory.mdx` SHALL distinguish collection-relative inventory from scoped placement without changing the derivation contract.
- **Portable contracts:** `docs/specification/project-manifest.mdx`, `docs/specification/lockfile.mdx`, `docs/specification/materialization.mdx`, `docs/specification/install.mdx`, and `docs/specification/manifest.mdx` SHALL explain reused formats, installed scope, invariant authored integrity, scoped consent/ownership, and the revised write boundary. Keep established routes and anchors.
- **Complete lifecycle:** `docs/cli/add.mdx`, `docs/cli/install.mdx`, `docs/cli/update.mdx`, `docs/cli/remove.mdx`, `docs/cli/list.mdx`, and `docs/cli/outdated.mdx` SHALL document `--user`, flag combinations, scope-labelled output, and recovery. `docs/cli/env.mdx` SHALL add user state/receipt/lock placement while retaining the shared-cache model and explaining supported native overrides.
- **Concepts/workflows:** root `README.md`, `docs/guides/install-facets.mdx`, `docs/guides/troubleshooting.mdx`, `docs/docs/learn/adapters.mdx`, and `docs/docs/learn/mcp-servers.mdx` SHALL distinguish personal versus project collections and actual native destinations, including Codex prompt invocation. Update `packages/cli/src/prompts/usage.txt` and generated command help alongside these pages.
- **Release history:** new release notes SHALL announce explicit opt-in user-wide writes and separate user MCP approval. Existing entries in `docs/changelog/index.mdx` SHALL remain historical, not be rewritten. Relevant package `AGENTS.md` rules SHALL be updated during implementation so project-only wording does not contradict the new scope contract.

The following existing promises SHALL be replaced in the corresponding implementation release:

- `docs/reference/adapter-sdk.mdx`: replace "Write project-scoped configuration only. Never create or modify a user-wide or system-wide file." with "Plan changes only in the requested project or user scope. System-wide configuration remains unsupported."
- `docs/specification/install.mdx`: replace "An installer MUST NOT modify user-wide or system-wide tool configuration." with "User-wide tool configuration MUST be modified only by an explicitly selected user-collection operation, with separate MCP approval. System-wide tool configuration MUST NOT be modified."
- `docs/cli/install.mdx`: replace "Only project-scoped files are touched." with "Without `--user`, only project-scoped files are touched. With `--user`, the operation targets the independent user collection."
- `docs/cli/env.mdx`: explain receipt `0.5` migration and downgrade limitations. Direct dotfiles users to track only `user/facets.json` and optionally `user/facets.lock`, never the entire `FACET_DIR`, which includes credentials, OAuth state, and machine-local receipts.

## Open Questions

None. Native compatibility checks are tracked in Migration Plan → Verification.
