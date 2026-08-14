# @agent-facets/adapter-claude-code

## 0.11.0

### Minor Changes

- [#527](https://github.com/agent-facets/facets/pull/527) [`5a334d0`](https://github.com/agent-facets/facets/commit/5a334d0451b44eae5b9a344356eb93aec3edff06) Thanks [@eXamadeus](https://github.com/eXamadeus)! - **Adapter API `0.3`: adapters plan, the CLI writes.** The asset and MCP contracts are now strictly read-only. An adapter inspects, decides what should change, and returns exact per-file transitions — an absolute path, the state it observed that path in, and the bytes to commit. The CLI performs every write.
    This buys guarantees no adapter could offer on its own, and now applies uniformly to assets, MCP documents, and the project's own manifest, lockfile, and receipt:
    -   **Concurrency.** The state an adapter reports is the write's precondition. A file something else edited between planning and writing is refused and reported, never clobbered.
    -   **Atomicity.** One logical operation's file changes commit together. A skill's primary, its companions, and its obsolete-companion removals all land or none do.
    -   **Exact restoration.** Both endpoints of every change are recorded, so a failure restores the precise prior bytes and permission bits — comments, formatting, and member order intact. Byte-exact rollback no longer depends on re-rendering an asset from parsed data, so YAML front matter and TOML survive a rollback exactly as the author wrote them.
    -   **No phantom drift.** A file already holding the bytes a plan would write contributes no change, so a re-install touches no modification time.
    **Breaking: `installAsset`, `readAsset`, and `deleteAsset` are replaced by `assets: false | { planInstall, planRemoval }`.** `supportsInstall` is gone — an adapter states its asset capability the same way it states MCP support, so "claims support" and "implements support" can no longer disagree.
    **Breaking: the MCP capability is `mcpServers: false | { plan }`.** `apply` is gone, as is the opaque plan type and the `conflict/document-changed` reason. Concurrency is detected once, by the CLI, for every file it writes. A document an adapter inspects but does not change is no longer journaled or restored.
    **`plan` returns `documentPaths`: every file it was computed from, including when it changes none of them.** The list grants nothing — a file named there and not changed is never written, journaled, or restored. It exists so the CLI can establish, before it asks for approval, that no two selected adapters manage the same configuration file; two that do now fail with both named, because neither ordering leaves both plans applicable. Every plan is also recomputed immediately before its own commit, including one that concluded nothing needed writing, so a document edited while the approval screen was open is reported rather than quietly reported as configured.
    **Breaking: every asset request carries `projectRoot`, at every scope.** Adapters must not derive the project from the process working directory: a caller installing into a tree it is not running inside would otherwise materialize assets somewhere else.
    **Breaking: the mutating SDK helpers are replaced by planners.** `installSkillBundle` / `readSkillBundle` / `deleteSkillBundle` become `planSkillBundleInstall` / `planSkillBundleRemoval`; `installSingleFileAsset` / … become `planSingleFileInstall` / `planSingleFileRemoval`; `applyMcpTextPlan` is gone and `prepareMcpTextPlan` now returns exact file mutations. `ADAPTER_API_VERSION_ASSETS_ONLY` and `AssetOnlyAdapter` are removed.
    A skill whose primary file is already gone now has its owned companions removed rather than retained: each companion has an exact observed state of its own, so removing it is reversible. The `obsolete-bundle-retained` warning is gone with the condition that produced it.

## 0.10.0

### Minor Changes

- [#505](https://github.com/agent-facets/facets/pull/505) [`1581764`](https://github.com/agent-facets/facets/commit/15817644d89dd94a8f041fa04892fe43ced17bbe) Thanks [@eXamadeus](https://github.com/eXamadeus)! - **BREAKING (pre-1.0 minor):** the adapter API advances from `0.1` to `0.2`, adding MCP server configuration to the adapter contract. `ADAPTER_API_VERSION` is now `'0.2'`, and the previous token is exported as `ADAPTER_API_VERSION_ASSETS_ONLY` (`'0.1'`) so compatibility-aware consumers can name both without hardcoding a literal. `ADAPTER_API_VERSION_PACKAGE_FIELD` is unchanged; a published adapter's `package.json` must declare `"facetAdapterApiVersion": "0.2"` and it must match what the bundle stamps at runtime, or verification fails after download.
  **BREAKING: `AdapterDefinition` requires a new `mcpServers` field.** Every existing custom adapter must add it and rebuild:
  ```ts
  mcpServers: false | McpServerCapability;
  ```
  It is a union rather than a boolean plus optional methods, so a partial capability is unrepresentable rather than merely discouraged — `defineAdapter` refuses a definition claiming MCP support without the complete contract. `false` is a legitimate permanent answer: the adapter stays fully usable for projects with no active declarations, and is reported as unable to serve one that has them. The field is deliberately MCP-specific; a future project-configuration feature gets its own capability rather than widening this one.
  **BREAKING: `Adapter` is no longer a single interface.** It is now the tagged union `AssetOnlyAdapter | McpCapableAdapter`, so consumers discriminate on the declared contract instead of probing for methods.
  **The MCP capability is prepare-then-apply, over the complete desired batch.** `prepare` receives `projectRoot`, the exhaustive desired contribution set, and the caller-verified `previouslyOwnedNames` — ownership comes from that list, never inferred from the document. It is strictly read-only, including when the target document does not yet exist. It returns per-key outcomes (`absent`, `equivalent`, `divergent`, each carrying `ownership`, plus `obsolete-owned` carrying `occupancy`), the complete set of `documentPaths` the change could affect, and an opaque `plan` the engine stores without inspecting. `apply` consumes that plan and performs one atomic update per document, returning `unchanged` or `changed` with `changedPaths` — every changed path must have been disclosed. Expected failures are values (`io-failed`, `parse-failed`, `validation-failed`, `conflict`), never thrown.
  **Adapters supply no inverse operation.** The engine captures byte preimages of every disclosed document before applying a plan, so rollback restores comments, formatting, and member order exactly without depending on adapter code being correct a second time.
  **Adapter-computed native-rendering equality is authoritative for no-write adoption.** It is semantic: comments, whitespace, member ordering, and omitted-versus-empty optional collections are not differences, while any value changing launch or connection behavior is. An adapter that cannot prove equality must classify the entry as `divergent` and fail safe.
  New exports supporting this: `reconcileMcpServers`, `mcpDeclarationLiterals`, `mcpOutcomesRequireWrite`, `McpNativeMatch`, `ReconcileMcpServersInput`, and the MCP capability types. `atomicWriteFileSync` is re-exported for adapters writing native documents. The declaration type is imported from `@agent-facets/protocol/mcp-declaration` rather than restated, so the adapter contract cannot drift from the published spec.
  **All three first-party adapters implement it** against their tools' documented project locations: Claude Code reconciles `mcpServers` in `.mcp.json`; OpenCode reconciles `mcp` in an existing `opencode.jsonc`, else an existing `opencode.json`, creating `opencode.jsonc` when neither exists and treating JSONC as canonical when both do; Codex reconciles `mcp_servers` tables in trusted-project `.codex/config.toml`. Each preserves unrelated settings, leaves server entries it neither desires nor owns untouched, edits syntax-aware so comments and formatting survive where the format allows, and writes project-scoped files only — never user-wide or system-wide configuration. None of them installs, launches, connects to, health-checks, or authenticates to a declared server.
  **The compatibility window widens rather than replaces.** The CLI's supported set becomes exactly `{'0.1', '0.2'}`. Membership is exact-token and unordered — neither supported token outranks the other, npm selection still picks the highest satisfying package version, and the npm `latest` dist-tag is never consulted. Unlike the `0.0`→`0.1` cutover, a `0.1` adapter remains fully supported: it only blocks a project that has active MCP declarations, and that failure names every affected adapter with the right remedy for each.
  Release ordering: this SDK release and the three first-party adapter releases publish `0.2` to npm **before** any `agent-facets` CLI release accepts it. Until that CLI ships, existing CLIs keep selecting the highest compatible `0.1` release, so this changeset intentionally carries **no** `agent-facets` bump — the CLI change that widens the supported set to `{0.1, 0.2}` lands in a later release cycle gated on all three first-party adapters having published `facetAdapterApiVersion: 0.2`. It also assumes the protocol release carrying `@agent-facets/protocol/mcp-declaration` is already live. Note that an **exact** npm request for one of these new releases from an older CLI fails rather than substituting an older one; that is intended, since exact requests are never silently redirected.

## 0.9.0

### Minor Changes

- [#438](https://github.com/agent-facets/facets/pull/438) [`d20cdae`](https://github.com/agent-facets/facets/commit/d20cdaebeefaa365fcd1eb06da80db59b2c1201c) Thanks [@eXamadeus](https://github.com/eXamadeus)! - **BREAKING (pre-1.0 minor):** the adapter asset contract is now tagged request/result unions instead of positional parameters, and the adapter API identifier advances from `0.0` to `0.1`.
  `installAsset`, `readAsset`, and `deleteAsset` each take a single request object tagged by `assetType` and return a discriminated result — expected failures (`not-found`, `invalid-companion-path`, `unsupported-scope`, `not-implemented`, `io-failed`) are structured values, never thrown errors. Skill requests carry a companion byte map plus the caller-verified owned companion path set for atomic multi-file skill bundles; agent and command requests structurally cannot carry companions. `defineAdapter` stubs for omitted methods now return `not-implemented` failures instead of throwing.
  The SDK's canonical `ADAPTER_API_VERSION` is now `0.1`, identifying this tagged contract; `defineAdapter()` stamps it and first-party packages publish `"facetAdapterApiVersion": "0.1"`. `0.0` named the earlier positional contract: a CLI that supports only `0.1` classifies a `0.0` adapter as well-formed but unsupported and fails closed (before any contract method or project write) with reinstall guidance. There is no positional/tagged compatibility bridge — an adapter built against `0.0` must be rebuilt against a `0.1` SDK release and reinstalled.
  New SDK helpers: `installSkillBundle` / `readSkillBundle` / `deleteSkillBundle` (staged all-or-nothing bundle replacement with rollback, ownership-set-based deletion, and empty-directory pruning), `installSingleFileAsset` / `readSingleFileAsset` / `deleteSingleFileAsset` (result-shaped single-file operations), and `validateContainedRelativePath` (pre-filesystem containment validation applied to every supplied companion path).
  Every adapter implementing the previous positional contract must migrate. The first-party claude-code, opencode, and codex adapters are migrated in their matching minor releases; codex delete operations now prune emptied directories consistently with the other adapters.
  Release ordering: this SDK release and the three first-party adapter releases publish `0.1` to npm **before** any `agent-facets` CLI release requires `0.1`. Until that CLI ships, existing `0.0` CLIs keep selecting the highest compatible `0.0` adapter release, so this changeset intentionally carries **no** `agent-facets` bump — the CLI change that makes `0.1` the supported set lands in a later release cycle gated on all three first-party adapters having published `facetAdapterApiVersion: 0.1`.

## 0.8.0

### Minor Changes

- [#447](https://github.com/agent-facets/facets/pull/447) [`d6581c6`](https://github.com/agent-facets/facets/commit/d6581c6046e12ca2c785ac9fe686a1967cd40205) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Declare adapter API `0.0` across the adapter toolchain. `defineAdapter()` now stamps a readonly `apiVersion` (`"0.0"`) onto every runtime adapter — the definition type excludes it, so authors cannot supply a conflicting value — and the SDK exports the canonical constants (`ADAPTER_API_VERSION`, `ADAPTER_API_VERSION_PACKAGE_FIELD`) from the new dependency-free `@agent-facets/adapter/api-version` subpath. First-party adapter packages now publish `"facetAdapterApiVersion": "0.0"` in their manifests (injected at pack time from the SDK constants) so compatibility-aware CLIs can select a compatible release from npm metadata before downloading it. The positional adapter method contract itself is unchanged: these releases remain fully consumable by already-published CLIs.

## 0.7.0

### Minor Changes

- [#424](https://github.com/agent-facets/facets/pull/424) [`12e7ff6`](https://github.com/agent-facets/facets/commit/12e7ff601a9e88ff42f9c5d45bce8a18263797b1) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Prune empty directories when removing assets and nothing is left in the directory

## 0.6.1

### Patch Changes

- [#404](https://github.com/agent-facets/facets/pull/404) [`ba747bd`](https://github.com/agent-facets/facets/commit/ba747bdcf1884ff82e397b21e9897a32eac8055c) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Widen the `typescript` peerDependency range to `^5 || ^6 || ^7` so the
  package installs cleanly for consumers on TypeScript 7. Consumers on
  TypeScript 5 or 6 are unaffected.

## 0.6.0

### Minor Changes

- [#393](https://github.com/agent-facets/facets/pull/393) [`b0c0be6`](https://github.com/agent-facets/facets/commit/b0c0be6a44bbfe4c9199684180d2ba3bd66f7949) Thanks [@eXamadeus](https://github.com/eXamadeus)! - BREAKING CHANGE: Rebrand from Facet.cafe to agentfacets.io for the registry

## 0.5.1

### Patch Changes

- [#382](https://github.com/agent-facets/facets/pull/382) [`79b1d50`](https://github.com/agent-facets/facets/commit/79b1d50b9ba1721081900e0f775cd3fed8dc2767) Thanks [@dependabot](https://github.com/apps/dependabot)! - Updated tsdown from 0.22.0 to 0.22.3

## 0.5.0

### Minor Changes

- [#325](https://github.com/agent-facets/facets/pull/325) [`ef26047`](https://github.com/agent-facets/facets/commit/ef26047602d8b546dfcb19c3fcef9c4ce485beaf) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added verbose logging and updated adapters to return asset install paths (for logging purposes)

### Patch Changes

- [#328](https://github.com/agent-facets/facets/pull/328) [`dc4bbd0`](https://github.com/agent-facets/facets/commit/dc4bbd080474c2bb45f09ab2f013bd5904afc209) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Upgraded bun from 1.3.13 to 1.3.14

## 0.4.6

### Patch Changes

- [#299](https://github.com/agent-facets/facets/pull/299) [`982eafd`](https://github.com/agent-facets/facets/commit/982eafda525fa318ea8c41582c7541f552f34962) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Minor CI caching improvement

## 0.4.5

### Patch Changes

- [#242](https://github.com/agent-facets/facets/pull/242) [`03e9604`](https://github.com/agent-facets/facets/commit/03e9604df207627bf1d5fc5cd2f212bc909239c5) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump it all, upgraded CI config need to verify release machinery

## 0.4.4

### Patch Changes

- [#221](https://github.com/agent-facets/facets/pull/221) [`b2f92a4`](https://github.com/agent-facets/facets/commit/b2f92a45198ec5495e9f8dae414881bffa1cd8a7) Thanks [@eXamadeus](https://github.com/eXamadeus)! - `facet add <source>` now resolves, writes, and installs in one step instead of leaving the user to run `facet install` separately. Multiple sources per invocation are supported. `facets.json` rolls back byte-for-byte on failure.
  The adapter picker auto-launches when `add` runs against a project with no connected adapters in a TTY. Non-TTY exits with a clear "no adapters installed" error.
  Source grammar tightened for closed alpha: `git+` prefixes hard-rejected, `^` / `~` / `1.x` ranges hard-rejected with a fix pointing at the supported `*` wildcards (`1.*`, `1.2.*`), and bare registry names route to a registry stub that errors clearly until the real registry ships.
  The install pipeline (sources, resolvers, lockfile I/O, materialization, integrity, cache, registry stub) moved from the CLI into `@agent-facets/core`. The CLI is now display-only on top.
  `@agent-facets/adapter` fixes a blank-line asymmetry in `assembleAssetContent` that made `materialize`'s skip-if-identical check see phantom drift on every re-install. First-party adapter packages republish at the patch level so the bundled fix reaches existing installs.

## 0.4.3

### Patch Changes

- [#211](https://github.com/agent-facets/facets/pull/211) [`66b2fa3`](https://github.com/agent-facets/facets/commit/66b2fa3f70b663ba28e64e4fbc16e0eb60f4498a) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump eveything to refresh publish pipelines

## 0.4.2

### Patch Changes

- [#206](https://github.com/agent-facets/facets/pull/206) [`d42ef55`](https://github.com/agent-facets/facets/commit/d42ef55cf5ab31f34fcdbac5ce4548b918a1bde4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Use pack-then-publish mechanism to ensure no drift between packument and published tarballs

## 0.4.1

### Patch Changes

- [#183](https://github.com/agent-facets/facets/pull/183) [`c9a1a4d`](https://github.com/agent-facets/facets/commit/c9a1a4dfe7e28437d6b523c6fa83ff17ac9b9f94) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Serial deploys via CI to ensure tag and release ordering

## 0.4.0

### Minor Changes

- [#168](https://github.com/agent-facets/facets/pull/168) [`8a697b5`](https://github.com/agent-facets/facets/commit/8a697b597842bcb4d3207ca73d429f4dff2be7b4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Clean up publish failures

## 0.3.0

### Minor Changes

- [#150](https://github.com/agent-facets/facets/pull/150) [`70ec72b`](https://github.com/agent-facets/facets/commit/70ec72b00cb9f679faa516dc973297d3d99b769b) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Adapter SDK + first-party adapters gain real install support.

## 0.2.3

### Patch Changes

- f673986 Thanks @eXamadeus! - Correct CircleCI deployment keys

## 0.2.2

### Patch Changes

- [#145](https://github.com/agent-facets/facets/pull/145) [`a09846b`](https://github.com/agent-facets/facets/commit/a09846bce2b449287261ed4511ff0c3ad1599d6e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - CircleCI

## 0.2.1

### Patch Changes

- [#142](https://github.com/agent-facets/facets/pull/142) [`2c74835`](https://github.com/agent-facets/facets/commit/2c74835443d78f16e0c4cc8effc8d7f0b01e593f) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fixed bundling of adapters
- [#144](https://github.com/agent-facets/facets/pull/144) [`5c235e0`](https://github.com/agent-facets/facets/commit/5c235e08126e7dd6640c921625189f6fca1b4d5d) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump em all. Test release pipeline

## 0.2.0

### Minor Changes

- [#128](https://github.com/agent-facets/facets/pull/128) [`a350666`](https://github.com/agent-facets/facets/commit/a3506668311707d96f46d912177abd868a1e88ce) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added in an SDK for adapting the facet CLI to various systems/tools

### Patch Changes

- [#129](https://github.com/agent-facets/facets/pull/129) [`f8a5a7b`](https://github.com/agent-facets/facets/commit/f8a5a7b78f96d8269042a05caf360ee95ed76cb4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Publish all packages touched

#### Updated Dependencies

- @agent-facets/adapter@0.2.0
