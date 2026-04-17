## Context

Harness-specific logic is currently hardcoded in `packages/core/src/build/validate-platforms.ts` as a `KNOWN_PLATFORMS` map binding harness names to inline arktype schemas. This couples core to every harness — adding Claude Code required editing core, and adding Codex will require the same. The install pipeline (next change) needs harnesses that do far more than validate config: asset management, config mutation, harness detection, and metadata validation. These responsibilities diverge significantly per harness and cannot remain hardcoded.

A spike on branch `julian/bun-dynamic-import-spike` proved that compiled Bun binaries can dynamically `import()` pre-bundled `.js` files from the filesystem at runtime, with one critical constraint: the binary's internal module graph is NOT accessible to dynamically imported code. Bare specifier imports (e.g., `import { X } from '@agent-facets/harness'`) fail even when the package is bundled into the binary. Pre-bundling harnesses into single `.js` files (all dependencies inlined via `bun build`) resolves this completely.

The facet manifest currently uses `platforms` for harness-specific config. This field SHALL be renamed to `harnesses` to align with the chosen terminology and avoid collision with OS/architecture platform targets used for binary distribution.

### Stakeholders

- **Facet authors**: Write `harnesses` metadata in manifests; unaffected beyond the field rename.
- **Harness authors** (first-party now, third-party later): Use the Harness SDK to author harnesses. Write TypeScript, call `defineHarness()`, publish. The CLI handles installation and bundling.
- **CLI consumers**: Transparent — harness loading is internal to the CLI.

### Constraints

- [ADR-7](https://www.notion.so/exmachina-co/ADR-7) governs the plugin model: dynamic `import()` of pre-bundled JavaScript, no external runtime dependency.
- [ADR-1](https://www.notion.so/exmachina-co/ADR-1) defines the manifest schema — `platforms` field SHALL be renamed to `harnesses`.
- [ADR-3](https://www.notion.so/exmachina-co/ADR-3) states directory mapping is a CLI concern — this change formalizes that delegation to harnesses.
- Phase 3 (Local Installation) at `../strategy/facets/roadmap/03-local-installation.md` is the roadmap context. This change is preparatory — it does not complete the phase.

## Goals / Non-Goals

**Goals:**

- Extract shared foundational types (`ValidationError`, `Result<T>`, `AssetType`, `Location`) into `@agent-facets/common`
- Build a Harness SDK that makes authoring harnesses straightforward
- Establish the harness as a full abstraction layer over its tool's storage and configuration
- Extract harness knowledge from core into separate harness packages built with the SDK
- Enable core to accept harnesses as inputs rather than hardcode them
- Provide `facet harness install/list/remove` commands for CLI-driven harness lifecycle management
- Rename `platforms` → `harnesses` across manifest schema, validation, and documentation

**Non-Goals:**

- Facet installation, asset placement, or directory writing (belongs to `local-install-pipeline`)
- Asset CRUD implementation (interface declared with stubs, deferred to install pipeline)
- `facet init` with interactive harness detection and project setup (belongs to `local-install-pipeline`)
- Config CRUD — MCP getters/setters, harness config mutation (pattern established, implementation deferred)
- MCP server configuration (harnesses MAY eventually manage MCP, but not in this change)
- Third-party harness registry, marketplace, or discovery
- Harness sandboxing or trust model
- `facet harness update` (deferred; users re-run `facet harness install` to update)

## Decisions

### 1. Shared foundation: `@agent-facets/common`

**Decision**: Create `packages/common/` as the shared foundational package. It exports:

- `ValidationError` — with fields `path`, `message`, `expected`, `actual`
- `Validated<T>` — discriminated union: `{ ok: true; data: T } | { ok: false; errors: ValidationError[] }`. `T` is required — every validation operation returns data on success. This replaces the previous `Result<T>` (which was only used for validation contexts) and `ValidationResult` (which was `Result<void>`). A single type covers all validation use cases: loaders return `Validated<FacetManifest>`, harnesses return `Validated<HarnessMetadata>`, etc.
- `AssetType` — singular form: `'skill' | 'agent' | 'command'`
- `Location` — `{ path: string, scope: 'system' | 'user' | 'project', type: 'directory' | 'file' }`

Pure TypeScript, zero dependencies. Private workspace package — not published to npm. Dev dependency for all other packages.

These types move out of `packages/core/src/types.ts`. `AssetType` is currently defined in three places with two incompatible shapes (singular in `detect-collisions.ts` and CLI, plural in `scanner.ts`). The canonical form SHALL be singular — the conceptual noun, not the filesystem/manifest key. Code that needs the plural form SHALL derive it.

The common package stays private because the SDK inlines its types at publish time via tsdown (see Decision 3). External consumers get these types from `@agent-facets/harness` directly.

**Rationale**: `ValidationError` and `Validated<T>` are generic patterns used across package boundaries. The `Location` type is shared between the SDK (harness definitions) and core (accepting harness inputs). `Validated<T>` unifies what was previously two types (`Result<T>` and `ValidationResult`) into a single type that reads naturally: `Validated<FacetManifest>`, `Validated<ServerManifest>`, `Validated<HarnessMetadata>`. Defining these in core creates a problematic dependency direction. A dedicated common package sits at the bottom of the dependency graph with zero dependencies.

**Alternatives considered**:
- *Define shared types in the SDK* — rejected because `ValidationError`, `Validated<T>`, and `Location` are not harness-specific concepts.
- *Keep types in core* — rejected because it creates a circular dependency (core depends on SDK, SDK depends on core).
- *Publish common to npm* — rejected; SDK inlines the types at publish time, so consumers never reference common directly.
- *Structural typing per package* — rejected because it creates duplicate sources of truth that can drift.
- *Separate `Result<T>` and `ValidationResult` types* — rejected; every use of `Result<T>` in the codebase is a validation context. A single `Validated<T>` type is cleaner and reads naturally.

### 2. Harness SDK: `@agent-facets/harness`

**Decision**: Create `packages/harness/` as the Harness SDK. It provides:

- **`defineHarness()` factory** — accepts a harness definition and returns a validated `Harness` object. This is the primary authoring surface.
- **`Harness` interface** — the full harness contract:
  - `name: string`
  - `assetLocations: Location[]` — ordered by precedence (highest first), where assets are stored
  - `configLocations: Location[]` — ordered by precedence (highest first), where config files live
  - `buildAssetMetadata(data: unknown): Validated<HarnessMetadata>` — takes raw per-asset metadata from a facet manifest, validates it, applies harness-specific defaults, and returns the enriched metadata object
  - `createAsset(location: Location, assetType: AssetType, name: string, content: string, metadata: unknown): void`
  - `readAsset(location: Location, assetType: AssetType, name: string): string`
  - `updateAsset(location: Location, assetType: AssetType, name: string, content: string, metadata: unknown): void`
  - `deleteAsset(location: Location, assetType: AssetType, name: string): void`
- **`Validated<T>`** — re-exported from `@agent-facets/common`. Used as the return type for `buildAssetMetadata`. No warnings — warnings are a pipeline-level concern.

The SDK does NOT contain build tooling or self-install logic. The CLI owns harness installation and bundling. Depends on `@agent-facets/common` as a dev dependency.

The harness is a full abstraction layer. The CLI never directly reads or writes assets — it always goes through the harness's CRUD methods. This means the harness owns all knowledge of its tool's directory structures, file formats, frontmatter conventions, and serialization. A harness could store assets in directories (markdown files), in a single JSON file, or in any other format — the CLI doesn't know or care.

CRUD methods SHALL always receive `Location` objects with absolute paths. The CLI is responsible for resolving any relative paths (e.g., from project-scoped locations) to absolute paths before calling CRUD. This resolution happens once at init time and is persisted in `facets.json` — the install pipeline's concern, not this change's. The harness's static `assetLocations` and `configLocations` arrays serve as the menu of possible locations; they MAY contain relative paths for project-scoped entries.

Harness availability detection (`isHarnessAvailable`) is intentionally omitted. The user's act of installing a harness via `facet harness install` is the availability signal. Attempting to auto-detect whether a tool is installed is unreliable (global binaries, npm local installs, Docker, custom setups) and not worth the complexity.

Asset CRUD methods SHALL be declared in the interface with stubs in this change. Full implementation belongs to the install pipeline. The stubs exist so the interface is complete and testable.

**Rationale**: `defineHarness()` as a factory provides validation, defaults, and a versioning path. Future interface versions can add methods (e.g., `getMcpConfig`, `setMcpConfig`) while the factory provides no-op defaults for backward compatibility. `buildAssetMetadata` both validates and enriches — harnesses can enforce defaults on metadata, and the build pipeline receives the fully resolved metadata object rather than just a pass/fail signal. The CRUD model over path resolution means the CLI never needs to understand how a harness stores assets — this is strictly better for extensibility and safety.

**Alternatives considered**:
- *Path resolution model (harness returns paths, CLI writes files)* — rejected because it forces the CLI to understand every harness's file format, directory structure, and serialization conventions. The CRUD model keeps that complexity in the harness.
- *SDK owns build tooling and self-install* — rejected; CLI owns installation and bundling.
- *Contract-only package (just types, no factory)* — rejected; `defineHarness()` provides validation, defaults, and versioning.

### 3. SDK publishing via tsdown

**Decision**: The SDK SHALL be published to npm via tsdown, which bundles JS and generates `.d.ts` declarations with types from `@agent-facets/common` inlined via `deps.alwaysBundle`. External consumers install `@agent-facets/harness` and get all types without needing `@agent-facets/common`.

tsdown is added as a dev dependency of the SDK package only.

**Rationale**: The SDK is the external-facing package for third-party harness authors. Not all consumers use Bun or TypeScript. Shipping bundled JS + `.d.ts` works everywhere. tsdown handles both in one tool, and `deps.alwaysBundle` cleanly inlines the private common package's types.

**Alternatives considered**:
- *Publish common to npm* — rejected; adds unnecessary package for consumers.
- *Ship raw `.ts`* — rejected for the SDK; third-party authors may not use Bun.
- *`dts-bundle-generator` or `api-extractor`* — rejected; tsdown handles both JS and declarations.

### 4. Location type: scoped paths with directory/file discriminant

**Decision**: The `Location` type SHALL be `{ path: string, scope: 'system' | 'user' | 'project', type: 'directory' | 'file' }`. Both `assetLocations` and `configLocations` on the harness are `Location[]`, ordered by precedence (highest first).

- `path` is a filesystem path — relative for project scope (e.g., `.opencode`), absolute for user/system scope (e.g., `~/.config/opencode`).
- `scope` classifies whether the location is system-level, user-level, or project-level.
- `type` discriminates between directories (containers for assets) and files (config targets).

Asset locations are typically directories (`type: 'directory'`). Config locations are typically files (`type: 'file'`). But the type discriminant is general — a future harness MAY store assets in a single file, or configs in a directory of YAML files. The `type` field is extensible (could add `'url'`, `'database'` in the future).

Precedence ordering means the first element is highest priority. For most tools, project-level locations have the highest precedence (they override user-level, which overrides system-level). The harness determines this ordering.

**Rationale**: Asset locations and config locations are conceptually similar (scoped paths) but serve different purposes. `assetLocations` feed into asset CRUD methods. `configLocations` will feed into future config CRUD methods. Keeping them as separate arrays with a shared type provides clarity without redundancy.

**Alternatives considered**:
- *Single `rootDir` string* — rejected; too simplistic for tools with multiple config directories at different scopes.
- *Combined locations array with type discriminant for asset/config* — rejected as premature; separate arrays are clearer and every consumer would need to filter.
- *Separate types for asset dirs and config files* — rejected; structurally identical today, and the `type` field already discriminates between directory and file.

### 5. Harness as full abstraction layer with CRUD operations

**Decision**: The harness SHALL be a full abstraction layer over its tool's storage. The CLI SHALL NOT directly read or write assets. Instead, the harness exposes CRUD methods:

- `createAsset(location, assetType, name, content, metadata)` — creates an asset at the given location. The harness handles path resolution, frontmatter/metadata assembly, file format, and directory creation internally.
- `readAsset(location, assetType, name)` — reads an asset's content from the given location.
- `updateAsset(location, assetType, name, content, metadata)` — updates an existing asset.
- `deleteAsset(location, assetType, name)` — removes an asset.

The `metadata` parameter on `createAsset` and `updateAsset` is the per-asset harness metadata from the facet manifest — the same data that `buildAssetMetadata` validates and enriches. The harness internally translates this into whatever format its tool expects (frontmatter, YAML headers, JSON properties, etc.).

This replaces the previous `resolveAssetPath` + separate `assembleFrontmatter` approach, which required the CLI to understand file formats and compose paths with frontmatter.

**Rationale**: Each AI coding tool has different conventions for asset storage — different directory structures, file extensions, frontmatter formats, and config file layouts. Rather than the CLI knowing every convention, the harness owns all of that complexity. The CLI becomes a thin orchestrator: it asks the harness for locations, lets the user choose, and delegates all I/O through CRUD methods.

This also enables future harnesses that store assets in unconventional ways — a single JSON file, a database, a remote API. The CRUD interface is storage-agnostic.

**Alternatives considered**:
- *Path resolution + frontmatter assembly (CLI writes files)* — rejected because the CLI would need to understand every harness's file format and directory structure. Adding a new harness would require CLI changes.
- *Path resolution only (no metadata handling)* — rejected because metadata/frontmatter is harness-specific and inseparable from asset creation.

### 6. CLI-driven harness installation

**Decision**: New `facet harness install` CLI command SHALL own the full harness installation pipeline. It accepts multiple specifier formats:

- **Built-in names**: `opencode`, `claude-code`, `codex` — hardcoded mapping to known npm packages.
- **npm packages**: `@scope/package` or `package-name` — downloaded from the npm registry.
- **Git URLs**: `git+https://...`, `git+ssh://...`, `git+http://...`, `git://...` — cloned using the `git` binary (same assumption as npm). Optional `#<commit-ish>` suffix.
- **Local paths**: `./path/to/harness` or `/absolute/path` — used directly from the filesystem.

The install flow:

1. Resolve specifier to a source (npm tarball, Git clone, or local directory)
2. Place source in a temp directory (except local paths, which are used in-place)
3. Run `bun install` in the source directory to resolve dependencies
4. Run `Bun.build()` on the entry point to produce a single self-contained `harness.js` with all dependencies inlined
5. Verify the bundle: load the built `harness.js`, check that it exports a valid `Harness` object, and read the `name` field to determine the harness identity
6. Place the bundle in `~/.facets/harnesses/<name>/harness.js` (where `<name>` comes from the harness's own `name` field)
7. Clean up temp directory

Additionally: `facet harness list` SHALL list installed harnesses from `~/.facets/harnesses/`, and `facet harness remove <name>` SHALL remove a harness from that directory.

Git URL support shells out to the `git` binary, which is assumed to be available on the user's machine (same assumption npm makes). If `git` is not installed, the CLI SHALL produce a clear error.

**Rationale**: CLI-driven installation eliminates friction for harness authors — they write TypeScript, publish, and the CLI handles bundling. The spike proved `Bun.build()` is available at runtime in compiled binaries. Post-bundle verification catches authoring errors at install time. The harness's `name` field is the single source of truth for identity.

**Alternatives considered**:
- *SDK handles bundling + postinstall self-install* — rejected; postinstall hooks are unreliable and burden authors.
- *Embed first-party in CLI binary* — rejected; divergent path, can't update independently.
- *Require authors to pre-bundle* — rejected; forces authors to understand the bundling constraint.

### 7. One harness package per AI coding tool

**Decision**: Create `packages/harnesses/opencode/`, `packages/harnesses/claude-code/`, and `packages/harnesses/codex/` as separate workspace packages, each authored with the SDK using `defineHarness()`.

**Rationale**: Each harness has distinct directory conventions, config schemas, asset storage patterns, and metadata schemas. Separate packages enforce clean boundaries. Each produces an independently installable harness.

**Alternatives considered**:
- *Single monolithic package* — rejected; blurs boundaries, no per-harness versioning.
- *Keep harness logic in core* — rejected; the status quo this change eliminates.

### 8. Pre-bundled JavaScript distribution

**Decision**: Each harness is loaded as a single self-contained `harness.js` file with all dependencies inlined. The CLI produces these bundles at install time using `Bun.build()`. The compiled CLI binary loads them at runtime via dynamic `import()`.

**Rationale**: The spike proved compiled Bun binaries cannot resolve bare specifier imports in dynamically imported files. Pre-bundling eliminates external resolution. Bundles are typically under 5KB and load in sub-millisecond time.

**Alternatives considered**:
- *Raw `.ts` files at runtime* — rejected; fails with bare specifier imports.
- *JSON-RPC / stdio protocol* — rejected; unnecessary complexity for function calls.

### 9. First-party and third-party harnesses use the same install mechanism

**Decision**: First-party harnesses (OpenCode, Claude Code, Codex) and third-party harnesses SHALL use the same install mechanism. That mechanism is: the CLI downloads the harness source, bundles the source into a self-contained `harness.js` via `Bun.build()`, installs the bundle into `~/.facets/harnesses/<name>/`, and later loads the bundle at runtime via dynamic `import()`. There is no separate code path for first-party harnesses.

**Rationale**: Dogfooding ensures the install and loading path works end-to-end. If first-party harnesses were statically bundled into the CLI or used a different delivery mechanism, bugs in the shared path could go undetected until third-party harnesses arrive. The performance difference is negligible (sub-millisecond import for a <5KB file).

**Alternatives considered**:
- *Static bundling for first-party, dynamic for third-party* — rejected because divergent paths hide bugs. Could be revisited as a performance optimization if harness loading ever becomes measurable, but current measurements show no need.
- *Ship first-party harnesses inside the CLI npm package* — rejected because it creates a divergent delivery path and prevents harnesses from being updated independently of CLI releases.

### 10. Core accepts harnesses as inputs

**Decision**: The build pipeline's validation stage SHALL accept an array of `Harness` objects as a parameter. `validate-platforms.ts` SHALL be renamed to `validate-harnesses.ts` and refactored to call each harness's `buildAssetMetadata()`. The enriched metadata returned on success SHALL be used by the pipeline. Unknown harnesses (in manifest but no matching harness provided) SHALL produce a warning.

Core is fully harness-agnostic — it has no knowledge of which specific harnesses exist, no alias mappings, and no hardcoded validation schemas. The old `KNOWN_PLATFORMS` map (which hardcoded per-harness arktype schemas in core) is removed entirely. Core receives `Harness[]` and works with whatever it gets.

The CLI maintains a small alias map for first-party convenience names (`opencode` → `@agent-facets/harness-opencode`, etc.) used during `facet harness install` specifier resolution. This is a CLI concern, not a core concern. For any tooling that needs to discover available harnesses (e.g., scaffolding, suggestions), the installed harnesses in `~/.facets/harnesses/` serve as the discovery mechanism — no hardcoded list needed.

**Rationale**: Core becomes fully harness-agnostic. Testable with mock harnesses. Extensible without modification. Adding a new harness never requires changes to core.

**Alternatives considered**:
- *Core discovers harnesses from disk* — rejected; core is a library, no filesystem opinions.
- *Core imports harness packages directly* — rejected; reintroduces coupling.
- *Alias map in core instead of CLI* — rejected; core doesn't need to know package names. The CLI is the only consumer of alias resolution. Installed harnesses serve as the discovery mechanism for other tooling.

### 11. `platforms` → `harnesses` rename in the manifest schema

**Decision**: The `platforms` field in `FacetManifestSchema` SHALL be renamed to `harnesses`.

**Rationale**: "Platform" collides with OS/architecture platforms per [ADR-7](https://www.notion.so/exmachina-co/ADR-7). "Harness" accurately describes the concept.

**Breaking change scope**: Limited blast radius — no consumer-facing install pipeline exists. Only internal test fixtures are affected.

### 12. Workspace configuration

**Decision**: Root `package.json` workspaces glob SHALL add `packages/harnesses/*`.

**Rationale**: Bun workspaces match one glob level. `packages/*` covers `packages/harness/` but not `packages/harnesses/opencode/`.

## Risks / Trade-offs

**[Risk] Dynamic `import()` of untrusted code** → Harnesses run with full process privileges. No sandboxing. Mitigation: deferred to future security hardening. Only first-party harnesses are loaded for now.

**[Risk] CLI-side bundling requires temp directory + `bun install`** → I/O and network overhead during harness installation. Mitigation: one-time cost at install time. Temp dirs cleaned up after. CLI binary includes the full Bun runtime.

**[Risk] Breaking manifest rename (`platforms` → `harnesses`)** → Existing `facet.json` files with `platforms` will fail. Mitigation: minimal blast radius — internal fixtures only.

**[Risk] Git URL support adds complexity** → Parsing Git URLs, cloning repos, finding entry points. Shells out to `git` binary (assumed available, same as npm). Clear error if missing. Mitigation: follow npm's Git URL format. Isolate resolution logic.

**[Trade-off] Same installation path for first-party and third-party** → First-party could be faster if statically bundled. Accepted: negligible performance difference, dogfooding is more valuable.

**[Trade-off] Zero arktype dependency in the SDK** → Authors can't reuse arktype from SDK. Accepted: framework freedom outweighs convenience. Authors add arktype directly if wanted.

**[Trade-off] tsdown as build dependency for SDK** → New tool in monorepo. Accepted: scoped to SDK only, solves declaration inlining cleanly.

**[Trade-off] CRUD stubs instead of full implementation** → Asset CRUD methods are stubs in this change. Accepted: the interface is correct and testable; full implementation deferred to install pipeline to keep this change focused.

## Documentation Impact

The following docs SHALL be updated:

| File | What changes |
|---|---|
| `docs/specification/manifest.mdx` | `platforms` → `harnesses`; field descriptions and examples |
| `docs/specification/publish.mdx` | "Validate platform config" → "Validate harness metadata" |
| `docs/specification/install.mdx` | "platform adapters" → "harnesses" |
| `docs/specification/architecture.mdx` | "Platform-agnostic format" prose; harness extension points |
| `docs/cli/build.mdx` | "Validate platforms" → "Validate harnesses" |
| `docs/learn/agents.mdx` | "platform-level configuration" → "harness-level configuration" |
| `docs/specification/terminology.mdx` | Add "harness" definition |
| `README.md` (root) | Update platform references |

New CLI documentation needed for `facet harness install/list/remove` commands.

Note: `docs/contributing/` references to "platform" in the binary distribution context do NOT need updating.

## Open Questions

None — all questions resolved.

### Resolved Questions

- **HARNESS_API_VERSION constant**: Resolved — removed. The SDK's own package version serves as the API version. When the CLI bundles a harness at install time, the SDK version the harness was built against is baked into the bundle. No separate constant needed.

- **Post-bundle verification**: Resolved — yes. The CLI SHALL load the built `harness.js` after bundling and verify it exports a valid `Harness` object before placement. Catches authoring errors at install time. Cost is negligible.

- **Harness name from Git URL / local path**: Resolved — use the `name` field from the `Harness` object itself (set via `defineHarness({ name: '...' })`). The CLI reads the name during post-bundle verification.
