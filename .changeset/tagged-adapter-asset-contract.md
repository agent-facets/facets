---
'@agent-facets/adapter': minor
'@agent-facets/adapter-claude-code': minor
'@agent-facets/adapter-opencode': minor
'@agent-facets/adapter-codex': minor
---

**BREAKING (pre-1.0 minor):** the adapter asset contract is now tagged request/result unions instead of positional parameters, and the adapter API identifier advances from `0.0` to `0.1`.

`installAsset`, `readAsset`, and `deleteAsset` each take a single request object tagged by `assetType` and return a discriminated result — expected failures (`not-found`, `invalid-companion-path`, `unsupported-scope`, `not-implemented`, `io-failed`) are structured values, never thrown errors. Skill requests carry a companion byte map plus the caller-verified owned companion path set for atomic multi-file skill bundles; agent and command requests structurally cannot carry companions. `defineAdapter` stubs for omitted methods now return `not-implemented` failures instead of throwing.

The SDK's canonical `ADAPTER_API_VERSION` is now `0.1`, identifying this tagged contract; `defineAdapter()` stamps it and first-party packages publish `"facetAdapterApiVersion": "0.1"`. `0.0` named the earlier positional contract: a CLI that supports only `0.1` classifies a `0.0` adapter as well-formed but unsupported and fails closed (before any contract method or project write) with reinstall guidance. There is no positional/tagged compatibility bridge — an adapter built against `0.0` must be rebuilt against a `0.1` SDK release and reinstalled.

New SDK helpers: `installSkillBundle` / `readSkillBundle` / `deleteSkillBundle` (staged all-or-nothing bundle replacement with rollback, ownership-set-based deletion, and empty-directory pruning), `installSingleFileAsset` / `readSingleFileAsset` / `deleteSingleFileAsset` (result-shaped single-file operations), and `validateContainedRelativePath` (pre-filesystem containment validation applied to every supplied companion path).

Every adapter implementing the previous positional contract must migrate. The first-party claude-code, opencode, and codex adapters are migrated in their matching minor releases; codex delete operations now prune emptied directories consistently with the other adapters.

Release ordering: this SDK release and the three first-party adapter releases publish `0.1` to npm **before** any `agent-facets` CLI release requires `0.1`. Until that CLI ships, existing `0.0` CLIs keep selecting the highest compatible `0.0` adapter release, so this changeset intentionally carries **no** `agent-facets` bump — the CLI change that makes `0.1` the supported set lands in a later release cycle gated on all three first-party adapters having published `facetAdapterApiVersion: 0.1`.
