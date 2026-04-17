## Why

Harness-specific logic is hardcoded in `packages/core/src/build/validate-platforms.ts` as a `KNOWN_PLATFORMS` map of harness names to arktype schemas. A "harness" is an AI coding tool (OpenCode, Claude Code, Codex) that wraps around an LLM and provides it with skills, agents, commands, and configuration. The term "harness" is chosen over "platform" to avoid collision with OS/architecture platforms (Darwin, Linux, Windows) already used in this project for binary distribution targets.

This cannot scale — adding new harnesses requires modifying core for every addition. The install pipeline (next change) needs harnesses that handle asset management, config mutation, harness detection, and metadata validation, and these concerns diverge significantly per harness. The harness must be a full abstraction layer over its tool's storage and configuration — the CLI should never directly read or write files for a harness. Each harness owns the complexity of its own directory structures, file formats, and conventions.

This change extracts harness knowledge into an SDK for authoring harnesses, separate harness packages per AI coding tool, a CLI-driven installation pipeline that downloads and bundles harnesses, and a runtime loading mechanism validated by spike (`julian/bun-dynamic-import-spike`). The SDK provides a `defineHarness()` factory and types, published professionally via tsdown (which inlines types from the internal common package). The CLI owns the full harness lifecycle: `facet harness install` downloads harness source from npm, Git repos, or local paths, bundles it into a self-contained `harness.js`, and places it in `~/.facets/harnesses/<name>/`. Harness authors write TypeScript, call `defineHarness()`, and publish — no build tooling knowledge required.

## What Changes

- **BREAKING**: The facet manifest field `platforms` SHALL be renamed to `harnesses`. All existing references to "platform" in manifest schemas, validation, and documentation SHALL be updated.
- New `@agent-facets/common` package (`packages/common/`) containing shared foundational types: `ValidationError`, `Validated<T>` (discriminated union: `{ ok: true; data: T } | { ok: false; errors: ValidationError[] }`), `AssetType` (singular form: `'skill' | 'agent' | 'command'`), and `Location` (`{ path: string, scope: 'system' | 'user' | 'project', type: 'directory' | 'file' }`). Pure TypeScript, zero dependencies. Private workspace package. Dev dependency for all other packages. The SDK inlines these types at publish time via tsdown.
- New `@agent-facets/harness` package (`packages/harness/`) — the Harness SDK. Contains the `Harness` interface, `Validated<T>` (re-exported from `@agent-facets/common`), and a `defineHarness()` factory function for authoring harnesses. Published to npm via tsdown, which bundles JS + `.d.ts` declarations with types from `@agent-facets/common` inlined. The SDK does NOT contain build tooling or self-install logic — the CLI owns harness installation.
- Harness authoring SHALL use `defineHarness()` from the SDK, which accepts: `name`, `assetLocations` (ordered array of `Location` objects for asset storage), `configLocations` (ordered array of `Location` objects for config files), `buildAssetMetadata` (validates and enriches per-asset harness metadata from a facet manifest, applying harness-specific defaults), and asset CRUD methods (`createAsset`, `readAsset`, `updateAsset`, `deleteAsset`). Asset CRUD methods SHALL be declared in the interface with stubs in this change — full implementation belongs to the install pipeline. The harness is a full abstraction layer: the CLI never directly reads or writes assets, it always goes through the harness's CRUD methods.
- `buildAssetMetadata` SHALL validate and enrich per-asset harness metadata from a facet manifest, applying harness-specific defaults, and returning a `Validated<HarnessMetadata>`: `{ ok: true; data: HarnessMetadata } | { ok: false; errors: ValidationError[] }`. No warnings — warnings are a pipeline-level concern.
- New `@agent-facets/harness-opencode`, `@agent-facets/harness-claude-code`, and `@agent-facets/harness-codex` packages implementing the harness for each AI coding tool using the SDK. Each harness owns its tool's `assetLocations`, `configLocations`, metadata building/validation schema, and harness detection logic.
- Harnesses SHALL be distributed as pre-bundled JavaScript files (single `.js`, all dependencies inlined). The CLI produces these bundles at install time using `Bun.build()` — harness authors do not need any build tooling. The compiled CLI binary loads harness bundles at runtime via dynamic `import()` per [ADR-7](https://www.notion.so/exmachina-co/ADR-7). The compiled binary's bundled modules are NOT accessible to dynamically imported code — pre-bundling is required.
- New `facet harness install` CLI command SHALL handle harness installation. It accepts multiple specifier formats: built-in names (`opencode`, `claude-code`, `codex`), npm packages, Git URLs (`git+https://...`, `git+ssh://...` — same format as npm Git dependencies), and local paths. The CLI downloads/clones the source, runs `bun install` to resolve dependencies, runs `Bun.build()` to produce a self-contained `harness.js`, verifies the bundle exports a valid harness, reads the harness's `name` field, and places the bundle in `~/.facets/harnesses/<name>/`. First-party harnesses SHALL use the same mechanism as third-party.
- New `facet harness list` and `facet harness remove <name>` CLI commands.
- Move harness validation out of `packages/core/src/build/validate-platforms.ts`. Core SHALL depend on `@agent-facets/common` for shared types and accept harnesses as inputs. The build pipeline SHALL delegate metadata building to each harness's `buildAssetMetadata` method.
- Workspace configuration SHALL add `packages/harnesses/*` to the workspace glob.

## Capabilities

### New Capabilities

- `harness__sdk`: The Harness SDK — `defineHarness()` factory, `Harness` interface, `Location` type, `@agent-facets/common` shared types, `@agent-facets/harness` package publishing via tsdown, and the authoring experience for harness developers.
- `harness__assets`: Asset management within harnesses — asset CRUD interface (`createAsset`, `readAsset`, `updateAsset`, `deleteAsset`), `buildAssetMetadata` (validation + enrichment with defaults), asset locations, and how assets are stored and managed per-harness.
- `harness__management`: CLI-driven harness lifecycle — `facet harness install/list/remove` commands, multi-source specifier resolution (npm, Git, local path), CLI-side bundling via `Bun.build()`, post-bundle verification, `~/.facets/harnesses/` directory, and runtime loading.

### Modified Capabilities

None. The build pipeline's validation behavior is unchanged from a requirements perspective — only the source of harness schemas changes and the manifest field is renamed.

## Non-Goals

- Facet installation, asset placement, or directory writing — belongs to `local-install-pipeline`. Harness installation IS in scope; facet installation is not.
- Asset CRUD implementation — interface declared with stubs, full implementation deferred to install pipeline
- `facet init` with interactive harness detection and project setup — belongs to `local-install-pipeline`
- Config CRUD (MCP getters/setters, harness config mutation) — the pattern is established but implementation is deferred
- MCP server configuration — harnesses MAY eventually manage MCP servers, but this is deferred
- Third-party harness registry or marketplace — harnesses are installed via npm, Git repos, or local paths
- Harness sandboxing or trust model — security implications of dynamic `import()` are acknowledged but deferred
- Harness configuration files (`.facets/config.local.json`, `~/.config/facets/`) — that is a `local-install-pipeline` concern
- `facet harness update` — deferred; users can re-run `facet harness install` to update

## Impact

- **New packages**: `packages/common/` (shared types, private), `packages/harness/` (SDK, published via tsdown), `packages/harnesses/opencode/`, `packages/harnesses/claude-code/`, `packages/harnesses/codex/`. Harness packages are published to npm as installable sources.
- **New CLI commands**: `facet harness install`, `facet harness list`, `facet harness remove`.
- **New ADR**: [ADR-7](https://www.notion.so/exmachina-co/ADR-7) (Harness Plugin Model) documents the dynamic `import()` approach, spike results, terminology decision, and compiled binary constraints.
- **BREAKING — Manifest rename**: `platforms` → `harnesses` in the facet manifest schema, all validation code, ADR-001, and documentation. Blast radius is limited to internal/author usage since no consumer-facing install pipeline exists yet.
- **Workspace config**: Root `package.json` workspaces updated to include `packages/harnesses/*`.
- **`packages/core`**: Depends on `@agent-facets/common` (dev dependency). `validate-platforms.ts` renamed and refactored to accept harnesses rather than hardcode schemas. `ValidationError` and `Validated<T>` imported from `@agent-facets/common`; `AssetType` unified to singular form.
- **`packages/cli`**: Gains `facet harness install/list/remove` commands. Dynamically imports harness bundles from `~/.facets/harnesses/`.
- **New build dependency**: tsdown added as dev dependency for the SDK package only.
- **Existing ADRs**: [ADR-1](https://www.notion.so/exmachina-co/ADR-1) — `platforms` field renamed to `harnesses`. [ADR-3](https://www.notion.so/exmachina-co/ADR-3) — directory mapping formalized as harness concern.
- **Roadmap**: Preparatory work for Phase 3 (Local Installation) at `../strategy/facets/roadmap/03-local-installation.md`, currently `planned`. This change alone does not complete the phase.
