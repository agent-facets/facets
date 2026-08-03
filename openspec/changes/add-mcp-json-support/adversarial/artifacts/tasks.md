> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## 1. Protocol Schemas & Fingerprint — Research

- [ ] 1.1 Explore: current facet-manifest schema — the `servers` member, the at-least-one-asset minimum-content constraint, asset-name grammar helpers, and unknown-field tolerance in `packages/protocol/src/schemas`
- [ ] 1.2 Explore: legacy `0.1` facet-manifest schema and the current/legacy validation dispatch (where format is selected, whether fallback exists) in protocol loaders and `parseFacetArchive`
- [ ] 1.3 Explore: the published `server.json` schema, its loader, and every consumer of those exports across protocol, engine, and CLI
- [ ] 1.4 Explore: project-manifest schema — version dispatch (unversioned vs `0.1`), expanded-entry `materialization` groups, duplicate-member rejection, and the engine `manifest/` read-write bridge
- [ ] 1.5 Explore: existing canonical-encoding and hashing utilities (`content-hash`, integrity) as patterns for a declaration fingerprint
- [ ] 1.6 Propose: approach for the protocol block — closed `McpServerDeclaration` tagged union + env-name grammar, server-only minimum-content disjunct, legacy `servers` rejection, project manifest `0.2` with `servers` disposition group, canonical semantic fingerprint, and removal of the standalone server-manifest schema/loader exports

## 2. Protocol Schemas & Fingerprint — Implementation

- [ ] 2.1 Implement: `McpServerDeclaration` closed tagged union (`stdio` with non-empty `command`, ordered `args`, literal `env` under the portable ASCII env-name grammar; `http` with absolute `http:`/`https:` `url`), rejecting cross-arm and unrecognized members with structured errors naming server and field; export the inferred type as the single source of truth
- [ ] 2.2 Implement: server names validated under the single-segment asset-name grammar in a namespace separate from text assets; minimum-content rule gains a `servers` disjunct so server-only manifests validate; declarations contribute no archive entries
- [ ] 2.3 Implement: legacy `0.1` manifest schema explicitly rejects any `servers` member while retaining text-asset acceptance; current manifests failing validation are never retried under legacy; current schema rejects version-string and `{ image }` server forms
- [ ] 2.4 Implement: project manifest `0.2` — exact three-form version dispatch (unversioned legacy, `0.1`, `0.2`), `materialization.servers` alias-or-omit group in `0.2` only, rejection of undeclared groups and of `servers` under `0.1`, compact-canonical and override-preservation producer rules, duplicate-member rejection before dispatch
- [ ] 2.5 Implement: canonical semantic declaration fingerprint — tagged kind + argument order preserved, env keys sorted, omitted optional collections normalized to empty, names excluded; deterministic `sha256:` output
- [ ] 2.6 Implement: remove the standalone server-manifest schema, `validateServerManifest` loader, and related public exports; update the protocol `index.ts` surface
- [ ] 2.7 Implement: protocol unit tests — declaration acceptance/rejection matrix, name/env grammar, server-only manifests, legacy `servers` rejection, manifest `0.2` dispatch and disposition groups, fingerprint invariance scenarios
- [ ] 2.8 Verify: run `bun check` for the protocol package

## 3. Receipt 0.4 — Research

- [ ] 3.1 Explore: receipt schema versions (`1`, `0.2`, `0.3`), the loader/refinement path, and where receipts are written in the tri-write in `packages/engine/src/install`
- [ ] 3.2 Explore: how receipt ownership drives deletion and no-op detection today (lockfile-guard, materialize, run-install), to site configuration claims beside asset ownership
- [ ] 3.3 Propose: receipt `0.4` shape — per-facet configuration claims (`kind`, authored `name`, authored-or-aliased `materialization`, `fingerprint`, witnessing facet integrity), explicit no-configuration-authority representation for pre-`0.4` receipts, and refinement rules

## 4. Receipt 0.4 — Implementation

- [ ] 4.1 Implement: receipt `0.4` schema and types — asset ownership retained, configuration claims added; omitted declarations unrepresentable; claims never store commands, args, URLs, or env names/values
- [ ] 4.2 Implement: loader refines `1`/`0.2`/`0.3` receipts to the in-memory `0.4` shape with asset authority preserved and an explicit marker that no configuration ownership or approval evidence exists (not a synthesized empty claim set)
- [ ] 4.3 Implement: receipt writer emits `0.4` on the next successful commit, never an intermediate format; unreadable or mismatched receipts still confer no ownership and are reported
- [ ] 4.4 Implement: receipt tests — refinement matrix, claim round-trip, approval-evidence derivation by `(kind, effectiveName, fingerprint)`, pre-`0.4` no-authority behavior
- [ ] 4.5 Verify: run engine package tests and types for the receipt/install modules

## 5. Composition, Consent & Ownership Engine — Research

- [ ] 5.1 Explore: existing effective-name planning — alias application, collision detection (`detect-collisions`), portable collision keys, and code-unit ordering in protocol `build/` and engine placement
- [ ] 5.2 Explore: the install orchestrator (`run-install`), journal, and where desired-state evaluation, no-op detection, and receipt-driven deletion happen today
- [ ] 5.3 Explore: how interactive prompts and non-interactive failures flow between engine and CLI today (install-service, result types), for siting the MCP consent request and takeover disclosure
- [ ] 5.4 Propose: approach for this block — one generic deterministic effective-name planning primitive reused by assets and servers (separate domain wrappers, no `AssetType` widening), configuration identity `(kind: 'mcp-server', effectiveName)`, fingerprint-keyed composition and collision groups, consent evaluation against receipt claims, and the desired-state-writes / receipt-deletes ownership rule extended to configuration

## 6. Composition, Consent & Ownership Engine — Implementation

- [ ] 6.1 Implement: extract the generic effective-name planning primitive preserving single-pass alias semantics, exhaustive collision reporting, portable keys, and ordering; re-wrap existing asset planning over it with unchanged behavior
- [ ] 6.2 Implement: MCP configuration composition — apply persisted aliases/omissions, group active claims by effective name, compose identical fingerprints into one effective configuration retaining all claimants, emit one complete collision report for differing fingerprints, keep servers out of every text-asset namespace
- [ ] 6.3 Implement: server alias/omission intent — read from manifest `0.2`, survive source changes and failed installs, prune stale server overrides only in a successful non-frozen commit with user-visible reporting, report as blocking drift in frozen mode
- [ ] 6.4 Implement: consent evaluation — diff active effective declarations against receipt claims by `(kind, effectiveName, fingerprint)`; produce one MCP-only consent request carrying every unapproved declaration with exact command/args/env or URL, claimant facets, and a distinct takeover section; asset ownership confers no MCP approval
- [ ] 6.5 Implement: structured result types for MCP outcomes (consent-required/accepted, added, updated, unchanged, aliased, omitted, removed, conflict, takeover-required/accepted/cancelled, unsupported-adapter) as discriminated unions, counted separately from assets
- [ ] 6.6 Implement: composition and consent unit tests — dedupe vs collision, alias/omission durability and pruning, approval reuse including no-op reproduction and identical second claimant, teammate-machine non-portability
- [ ] 6.7 Verify: run engine package tests and types

## 7. Adapter SDK 0.2 & Compatibility Window — Research

- [ ] 7.1 Explore: `defineAdapter` factory, `apiVersion` ownership, definition validation, and types in `packages/adapter`
- [ ] 7.2 Explore: engine adapter verification, loading, listing, npm version selection, and package-versus-runtime token agreement (`adapters/verify`, `loader`, `install-service`)
- [ ] 7.3 Propose: approach — `mcpServers: false | McpServerCapability` (batch read-only `prepare` returning per-key outcomes, affected document paths, and an opaque plan; atomic `apply` returning unchanged/changed; discriminated expected failures; no inverse operations), consuming the protocol declaration type without redeclaration; SDK canonical identifier `0.2`; engine support set exactly `{'0.1','0.2'}` with unchanged exact-token semantics

## 8. Adapter SDK 0.2 & Compatibility Window — Implementation

- [ ] 8.1 Implement: SDK — required `mcpServers` field typed `false | McpServerCapability`; capability operations typed over the protocol declaration import; factory emits canonical readonly `apiVersion: '0.2'` and ignores author-supplied values; partial capabilities fail validation or type checking
- [ ] 8.2 Implement: engine support set becomes exactly `{'0.1','0.2'}` — verification, loading, listing, and npm selection accept both tokens by membership; per-adapter package/runtime agreement stays exact-token; `0.0` remains unsupported before any contract call
- [ ] 8.3 Implement: MCP-support preflight — with active declarations, collect every selected `0.1` adapter and `0.2` adapter with `mcpServers: false` into one unsupported-adapter failure with upgrade/omission guidance, before consent and before any mutation
- [ ] 8.4 Implement: npm selection tests across mixed-token releases (highest compatible wins, exact requests never substituted, `latest`/wildcards constrained to the support set) plus SDK factory tests
- [ ] 8.5 Verify: run adapter SDK and engine package checks

## 9. First-Party Adapters — Research

- [ ] 9.1 Explore: Claude Code adapter internals and the `.mcp.json` `mcpServers` document shape
- [ ] 9.2 Explore: OpenCode adapter internals and the `opencode.jsonc`/`opencode.json` selection problem, including JSONC comment-preserving parse/edit options available in the dependency tree
- [ ] 9.3 Explore: Codex adapter internals, `.codex/config.toml` `mcp_servers` tables, and TOML syntax-preserving edit options
- [ ] 9.4 Propose: approach — per-adapter native rendering of `stdio`/`http`, adapter-computed semantic equality (formatting/ordering/empty-vs-omitted never divergent; behavior-affecting values divergent; unprovable equality fails safe as divergent), occupancy classification against receipt-authorized previous identities, one atomic write per document, and the shared fixture strategy

## 10. First-Party Adapters — Implementation

- [ ] 10.1 Implement: Claude Code capability — prepare/apply over project `.mcp.json`, preserving unrelated members and unowned server keys; document creation described in prepare, performed only in apply
- [ ] 10.2 Implement: OpenCode capability — select existing `opencode.jsonc`, else existing `opencode.json`, else create `opencode.jsonc` (`jsonc` canonical when both exist); reconcile the `mcp` map with comment- and format-preserving edits
- [ ] 10.3 Implement: Codex capability — prepare/apply over trusted-project `.codex/config.toml` `mcp_servers` tables with syntax-aware TOML editing preserving unrelated tables and comments
- [ ] 10.4 Implement: all three — structured parse-failure results leaving documents byte-identical, per-key outcome classification (absent/equivalent/divergent/tracked/untracked occupancy), preservation of safe native extension fields on owned entries, and no user-level file access
- [ ] 10.5 Implement: fixture-based adapter tests — translation of both declaration arms, equality matrix, unrelated-content preservation, atomic batch semantics, handled-failure non-mutation, formatting-preservation best effort
- [ ] 10.6 Verify: run first-party adapter package checks

## 11. Install Pipeline & Transaction — Research

- [ ] 11.1 Explore: the commit sequence and journal in `run-install`/`journal` — lock acquisition, resolution, materialization ordering, tri-write, and rollback replay
- [ ] 11.2 Explore: frozen-mode consistency checks and the removal-only short circuit, including what evidence each path has before fetching
- [ ] 11.3 Explore: the `server-warning` stage event, `serverWarnings` result field, CLI renderer, and warn-and-skip tests slated for removal
- [ ] 11.4 Explore: where asset application reads previous state today (no-op detection, rollback preimages) to host the just-in-time asset takeover gate without an eager scan
- [ ] 11.5 Propose: approach for the pipeline block — the full commit sequence (preflight → compose → adapter prepare → consent → journal → assets with just-in-time takeover → MCP apply → tri-write), byte-preimage journaling of adapter-disclosed documents with LIFO restore, frozen-mode gating, removal carry-forward proof rules with pre-`0.4` fallback, and outcome classification

## 12. Install Pipeline & Transaction — Implementation

- [ ] 12.1 Implement: commit-sequence reordering — compose and fail on unresolved collisions, verify adapter capability, run every adapter `prepare` read-only, and fail on parse or native conflicts, all before consent and before the journal opens
- [ ] 12.2 Implement: MCP consent + takeover gate before mutation — interactive single-request flow, non-interactive failure without pre-supplied approval, frozen never prompts, decline returns a structured no-mutation failure
- [ ] 12.3 Implement: journal byte preimages of each prepared plan's disclosed documents before its `apply`; apply MCP plans after asset writes and immediately before tri-write; LIFO replay of configuration byte restores and asset inverses on any later failure, leaving no approval or ownership evidence behind
- [ ] 12.4 Implement: just-in-time asset takeover gate during application using the existing previous-state read — interactive continue-or-cancel with continue default, non-interactive auto-continue, equivalent adoption without writes, cancellation rolls back the journal
- [ ] 12.5 Implement: receipt commit — record configuration claims only for active successfully reconciled declarations through the final tri-write; approval never persists from failed operations
- [ ] 12.6 Implement: frozen mode — derive declarations from integrity-pinned content and dispositions from the supported manifest without migration; fail before cleanup on collisions, stale overrides, unsupported adapters, invalid native config, integrity mismatch, or missing approval; allow receipt-only server-orphan cleanup when every check passes
- [ ] 12.7 Implement: removal path — delete an effective server entry only when receipt-owned and unused by remaining claims; carry claims forward without fetching only under receipt/lockfile integrity-anchored proof, falling back to ordinary resolution otherwise (always with a pre-`0.4` receipt)
- [ ] 12.8 Implement: remove the `server-warning` event, `serverWarnings` field, warn-and-skip tests, and CLI renderer; wire the new structured MCP events and outcome classification (updated vs repaired vs unchanged, takeover combinations, separate asset/config counts)
- [ ] 12.9 Implement: engine integration tests — full-sequence success, each pre-mutation failure leaving state untouched, mid-apply failure restoring exact bytes across multiple adapters, tri-write failure rollback, frozen scenarios, removal carry-forward and fallback
- [ ] 12.10 Verify: run engine package tests and types

## 13. CLI Surface — Research

- [ ] 13.1 Explore: the interactive collision workspace views/hooks in `packages/cli/src/tui` and how claimants, statuses, and live validation are modeled today
- [ ] 13.2 Explore: flag plumbing and help output for `add`, `install`, and `remove`, plus the summary/error renderers and verbose output paths
- [ ] 13.3 Propose: approach — MCP approval screen (declaration + takeover sections, full command/args/env or URL display, all-or-nothing accept), `--accept-mcp` on all three commands as the sole flag, server claimants in the collision workspace, separate asset-takeover continue/cancel screen, and summary plus non-interactive error formats that never leak declaration contents outside the approval display

## 14. CLI Surface — Implementation

- [ ] 14.1 Implement: MCP-configuration-only approval screen — every unapproved effective server with claimant facets and exact command/arguments/environment or URL, distinct takeover section with adapter and equivalence, accept-all or decline (non-zero exit stating no changes were made)
- [ ] 14.2 Implement: `--accept-mcp` on `add`, `install`, and `remove` with shared help text; non-interactive unapproved runs fail with the complete declaration list; frozen honors the flag without prompting; the flag never accepts asset takeovers
- [ ] 14.3 Implement: collision workspace — server collision groups with facet, authored/effective names, declaration summary, and disposition; Keep/Alias/Omit with live cross-group draft validation over the shared identity spaces; cancellation or interrupt leaves all state unchanged and exits non-zero
- [ ] 14.4 Implement: asset takeover continue-or-cancel screen (continue default, cancellation reports restoration outcome); non-interactive asset path stays prompt-free
- [ ] 14.5 Implement: summaries and errors — separate MCP outcome reporting with authored→effective alias display, server-only facets never presented as no-ops, stale-intent pruning notices, non-interactive collision errors with `materialization.servers.<name>` locations and valid snippets, and no declaration contents in verbose or persistent output
- [ ] 14.6 Implement: CLI e2e tests — approval accept/decline, `--accept-mcp` on all three commands, server collision resolution, server-only install summary, takeover flows, output-leakage checks
- [ ] 14.7 Verify: run `bun run --cwd packages/cli test:e2e` and CLI package checks

## 15. Documentation & Final Verification — Research

- [ ] 15.1 Explore: audit every doc named in the design's documentation decision — `docs/specification/{manifest,build,index,project-manifest,materialization,commit,lockfile,terminology,publish}.mdx`, `docs/index.mdx`, `docs/cli/{install,add}.mdx` and the remove reference, `docs/guides/{install-facets,custom-adapters}.mdx`, troubleshooting, `docs/roadmap/{beta,stable}.mdx`, and root `README.md` — for statements the change invalidates, including the obsolete server-warning pointer
- [ ] 15.2 Propose: doc update plan mapping each affected page to its new content (concrete declarations, manifest `0.2`, receipt `0.4`, consent and `--accept-mcp`, adapter API `0.2`, takeover flows, unchanged lockfile) plus the changelog entry

## 16. Documentation & Final Verification — Implementation

- [ ] 16.1 Implement: specification docs — manifest/build/index for concrete declarations and server-only facets; project-manifest/materialization for `0.2` dispositions and shared collision semantics; commit/lockfile/terminology for composition, consent, receipt `0.4`, keyed ownership, and the unchanged lockfile; publish for declarations traveling inside the manifest without independent resolution
- [ ] 16.2 Implement: CLI and guide docs — install/add/remove for prompts, `--accept-mcp`, conflicts, unsupported adapters, frozen behavior, outcomes, takeover and rollback; custom-adapters for API `0.2`, the `mcpServers` union, native-rendering equality, and preservation obligations; troubleshooting updates; remove the obsolete server-warning pointer
- [ ] 16.3 Implement: roadmap pages mark concrete MCP configuration shipped; root `README.md` no longer describes facets as text-assets-only; add the `docs/changelog` entry for declarations, consent, and adapter API `0.2`
- [ ] 16.4 Verify: full-repo `bun check` (protocol, adapter SDK, first-party adapters, engine, CLI, scripts, docs checks) including the end-to-end install scenarios
