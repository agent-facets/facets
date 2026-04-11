> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## Step Types

- **Verify** → CHECK. Run automated checks (tests, lint, type checks).
  If all checks pass, proceed. If anything fails, STOP and notify the user.
- **Implement** → WRITE. Make code changes — create, edit, or delete files.
- **Propose** → READ-ONLY + USER GATE. Show the user intended changes and ask for approval
  using the `question` tool. Do not write anything. Do not proceed until the user approves.
- **Explore** → READ-ONLY. Read files, search the codebase, investigate broadly.
  No writes allowed. Use this to understand the problem space before acting.
- **Review** → READ-ONLY + USER GATE. Analyze what was done or found, present findings
  to the user, and wait for feedback before proceeding.

## 1. Foundation Packages — Research

- [ ] 1.1 Explore: Investigate existing `packages/core/src/types.ts` to understand current `ValidationError` and `Result<T>` usage across the codebase, identify all import sites that need updating
- [ ] 1.2 Explore: Investigate existing `AssetType` definitions across the codebase (scanner.ts, detect-collisions.ts, CLI) to catalog all locations that need unification to the singular form
- [ ] 1.3 Explore: Research tsdown configuration patterns — `deps.alwaysBundle`, `.d.ts` generation, and how to inline types from a workspace dependency into the SDK's published output
- [ ] 1.4 Propose: Approach for creating `@agent-facets/common` and `@agent-facets/harness` packages, including directory structure, package.json configuration, and the migration path for moving types out of core

## 2. Foundation Packages — Implementation

- [ ] 2.1 Implement: Create `@agent-facets/common` package at `packages/common/` — `ValidationError`, `Validated<T>`, `AssetType` (singular), `Location` type. Private workspace package, zero dependencies.
- [ ] 2.2 Implement: Create `@agent-facets/harness` SDK package at `packages/harness/` — `Harness` interface, `defineHarness()` factory, re-export types from common. Dev dependency on common.
- [ ] 2.3 Implement: Add asset CRUD method stubs in `defineHarness()` — `createAsset`, `readAsset`, `updateAsset`, `deleteAsset` with stub implementations as defaults
- [ ] 2.4 Implement: Add `buildAssetMetadata` as a required method in the `Harness` interface, accepting raw metadata and returning `Validated<HarnessMetadata>`
- [ ] 2.5 Implement: Add tsdown build configuration for the SDK package — bundle JS + `.d.ts` with types from `@agent-facets/common` inlined via `deps.alwaysBundle`
- [ ] 2.6 Implement: Update root `package.json` workspaces glob to include `packages/harnesses/*`
- [ ] 2.7 Verify: Foundation packages — run `bun check`, verify SDK builds via tsdown, verify types are properly inlined in output

## 3. Core Refactoring — Research

- [ ] 3.1 Explore: Investigate `packages/core/src/build/validate-platforms.ts` — current `KNOWN_PLATFORMS` map, validation flow, and build pipeline integration
- [ ] 3.2 Explore: Investigate `packages/core/src/schemas/facet-manifest.ts` — `platforms` field definition and all downstream usage of the field name
- [ ] 3.3 Explore: Catalog all references to `platforms` across the codebase — schema definitions, tests, documentation, CLI commands — to determine the full rename blast radius
- [ ] 3.4 Propose: Approach for refactoring core to accept `Harness[]` as inputs, renaming `platforms` → `harnesses` in the manifest schema, and migrating `ValidationError`/`Result<T>` imports to `@agent-facets/common`

## 4. Core Refactoring — Implementation

- [ ] 4.1 Implement: Migrate `packages/core/src/types.ts` — replace `Result<T>` with import of `Validated<T>` from `@agent-facets/common`, update all import sites across core
- [ ] 4.2 Implement: Unify `AssetType` — replace all plural forms (`'skills' | 'agents' | 'commands'`) with singular form imported from `@agent-facets/common`, update derivation sites
- [ ] 4.3 Implement: Rename `platforms` → `harnesses` in `FacetManifestSchema` and all downstream types
- [ ] 4.4 Implement: Rename `validate-platforms.ts` → `validate-harnesses.ts`, refactor to accept `Harness[]` parameter and call `buildAssetMetadata()` on each harness. Remove `KNOWN_PLATFORMS` map and inline arktype schemas.
- [ ] 4.5 Implement: Update `packages/core/src/build/pipeline.ts` to pass harnesses to the renamed validation function
- [ ] 4.6 Implement: Update `packages/core/src/index.ts` public API exports to reflect renames
- [ ] 4.7 Implement: Update all core tests to use new types, imports, and harness-based validation
- [ ] 4.8 Verify: Core refactoring — run `bun check`, ensure all tests pass, verify no remaining references to `platforms` or `KNOWN_PLATFORMS`

## 5. First-Party Harness Packages — Research

- [ ] 5.1 Explore: Investigate OpenCode directory conventions — `.opencode/` structure, asset paths for skills/agents/commands, config file locations, metadata schema
- [ ] 5.2 Explore: Investigate Claude Code directory conventions — `.claude/` structure, asset paths, config file locations, metadata schema
- [ ] 5.3 Explore: Investigate Codex directory conventions — `.codex/` structure, asset paths, config file locations, metadata schema
- [ ] 5.4 Propose: Approach for implementing the three first-party harness packages, including `assetLocations`, `configLocations`, `buildAssetMetadata` schemas, and package structure

## 6. First-Party Harness Packages — Implementation

- [ ] 6.1 Implement: Create `@agent-facets/harness-opencode` at `packages/harnesses/opencode/` — `defineHarness()` with OpenCode-specific asset locations, config locations, and `buildAssetMetadata` using arktype
- [ ] 6.2 Implement: Create `@agent-facets/harness-claude-code` at `packages/harnesses/claude-code/` — `defineHarness()` with Claude Code-specific locations and metadata validation
- [ ] 6.3 Implement: Create `@agent-facets/harness-codex` at `packages/harnesses/codex/` — `defineHarness()` with Codex-specific locations and metadata validation
- [ ] 6.4 Implement: Add tests for each first-party harness — metadata validation, location correctness, factory validation
- [ ] 6.5 Verify: First-party harness packages — run `bun check`, verify each harness builds and exports a valid `Harness` object

## 7. CLI Harness Management Commands — Research

- [ ] 7.1 Explore: Investigate existing CLI command structure in `packages/cli/src/commands/` to understand patterns for adding new commands and subcommand groups
- [ ] 7.2 Explore: Research npm registry API and tarball download mechanisms available in Bun — how to download and extract an npm package programmatically
- [ ] 7.3 Explore: Research Git URL parsing — npm's Git URL format (`git+https://`, `git+ssh://`, `#<commit-ish>`), how to shell out to `git clone` from a compiled Bun binary
- [ ] 7.4 Explore: Confirm `Bun.build()` runtime API works in compiled binary — reference spike results on branch `julian/bun-dynamic-import-spike`, determine entry point resolution strategy for downloaded packages
- [ ] 7.5 Propose: Approach for implementing `facet harness install/list/remove` commands, including specifier resolution, temp directory management, bundling flow, verification, and placement

## 8. CLI Harness Management Commands — Implementation

- [ ] 8.1 Implement: Create specifier resolution module — resolve built-in names to npm packages, parse npm specifiers, parse Git URLs, detect local paths
- [ ] 8.2 Implement: Create npm source resolver — download npm package tarball to temp directory, extract
- [ ] 8.3 Implement: Create Git source resolver — parse Git URL, shell out to `git clone` in temp directory, handle `#<commit-ish>` suffix, produce clear error if `git` binary is missing
- [ ] 8.4 Implement: Create local path source resolver — validate path exists, use in-place
- [ ] 8.5 Implement: Create harness bundling module — run `bun install` in source directory, run `Bun.build()` on entry point, produce self-contained `harness.js`
- [ ] 8.6 Implement: Create post-bundle verification — load built `harness.js`, verify it exports a valid `Harness` object, read `name` field
- [ ] 8.7 Implement: Create harness placement — create `~/.facets/harnesses/<name>/` directory, place verified `harness.js`, clean up temp directory
- [ ] 8.8 Implement: Wire `facet harness install` command — integrate specifier resolution, source downloading, bundling, verification, and placement
- [ ] 8.9 Implement: Create `facet harness list` command — scan `~/.facets/harnesses/` directory, display installed harness names
- [ ] 8.10 Implement: Create `facet harness remove` command — delete harness directory from `~/.facets/harnesses/<name>/`, report error if not found
- [ ] 8.11 Implement: Create harness runtime loading — scan `~/.facets/harnesses/` at CLI startup, dynamically import each `harness.js`, pass loaded harnesses to core build pipeline
- [ ] 8.12 Implement: Add tests for harness management commands — install from local path, list, remove, verification failure, missing git binary error
- [ ] 8.13 Verify: CLI harness management — run `bun check`, test end-to-end flow with first-party harness packages

## 9. Documentation Updates — Research

- [ ] 9.1 Explore: Catalog all docs referencing `platforms` or platform-related behavior — identify specific files and lines that need updating

## 10. Documentation Updates — Implementation

- [ ] 10.1 Implement: Update `docs/specification/manifest.mdx` — `platforms` → `harnesses`, update field descriptions and examples
- [ ] 10.2 Implement: Update `docs/specification/publish.mdx` — "Validate platform config" → "Validate harness metadata"
- [ ] 10.3 Implement: Update `docs/specification/install.mdx` — "platform adapters" → "harnesses"
- [ ] 10.4 Implement: Update `docs/specification/architecture.mdx` — "Platform-agnostic format" prose, clarify harness extension points
- [ ] 10.5 Implement: Update `docs/cli/build.mdx` — "Validate platforms" → "Validate harnesses"
- [ ] 10.6 Implement: Update `docs/learn/agents.mdx` — "platform-level configuration" → "harness-level configuration"
- [ ] 10.7 Implement: Update `docs/specification/terminology.mdx` — add "harness" definition
- [ ] 10.8 Implement: Update root `README.md` — update platform references to harness terminology
- [ ] 10.9 Implement: Add CLI documentation for `facet harness install/list/remove` commands
- [ ] 10.10 Verify: Documentation — check no remaining references to `platforms` in docs (except binary distribution context in `docs/contributing/`)

## 11. Final Verification

- [ ] 11.1 Verify: Full integration — run `bun check` across the entire monorepo, ensure all tests pass, all packages build correctly
- [ ] 11.2 Review: Roadmap phase status — check whether Phase 3 (Local Installation) success criteria at `../strategy/facets/roadmap/03-local-installation.md` are fully met. This change is preparatory and does NOT complete the phase — note explicitly what remains (facet installation, asset CRUD implementation, `facet init`, config cascade).
