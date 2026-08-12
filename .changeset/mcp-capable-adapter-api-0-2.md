---
'@agent-facets/adapter': minor
'@agent-facets/adapter-claude-code': minor
'@agent-facets/adapter-opencode': minor
'@agent-facets/adapter-codex': minor
---

**BREAKING (pre-1.0 minor):** the adapter API advances from `0.1` to `0.2`, adding MCP server configuration to the adapter contract. `ADAPTER_API_VERSION` is now `'0.2'`, and the previous token is exported as `ADAPTER_API_VERSION_ASSETS_ONLY` (`'0.1'`) so compatibility-aware consumers can name both without hardcoding a literal. `ADAPTER_API_VERSION_PACKAGE_FIELD` is unchanged; a published adapter's `package.json` must declare `"facetAdapterApiVersion": "0.2"` and it must match what the bundle stamps at runtime, or verification fails after download.

**BREAKING: `AdapterDefinition` requires a new `mcpServers` field.** Every existing custom adapter must add it and rebuild:

```ts
mcpServers: false | McpServerCapability
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
