## Why

Platform-specific logic is hardcoded in `packages/core/src/build/validate-platforms.ts` as a `KNOWN_PLATFORMS` map of platform names to arktype schemas. This works for build-time validation of two platforms, but the install pipeline needs adapters that also handle directory mapping, frontmatter assembly, platform detection, and eventually MCP server configuration. Each platform's concerns will diverge significantly — OpenCode has different tooling support, config shapes, and runtime semantics than Claude Code. Embedding all of this in core creates a monolith that grows with every new platform.

This change extracts platform knowledge into a plugin architecture: a contract package defining the adapter interface, and separate adapter packages for each supported platform. Adapters are compiled into the CLI binary at build time — they are workspace packages for code organization, not independently distributed artifacts. This is a prerequisite for the local install pipeline — `facet add` needs adapters to know where to place files and how to assemble platform-native frontmatter.

## What Changes

- New `@agent-facets/adapter` package (`packages/adapter/`) containing the adapter interface, asset type definitions, validation result types, and related contracts. Zero runtime dependencies.
- New `@agent-facets/adapter-opencode` package (`packages/adapters/opencode/`) implementing the adapter interface for OpenCode. Owns the OpenCode config validation schema (arktype), exports typed `OpenCodeConfig`, directory mapping (`.opencode/`), asset path resolution (`skills/<name>/SKILL.md`, `agents/<name>.md`, `commands/<name>.md`), and platform detection (`isAvailable`).
- New `@agent-facets/adapter-claude-code` package (`packages/adapters/claude-code/`) implementing the adapter interface for Claude Code. Same shape as OpenCode — different root dir (`.claude/`) and config schema (permissions instead of model).
- The adapter interface SHALL declare `validateConfig(data: unknown): ValidationResult` as a generic function. Adapters implement validation internally using arktype (or any other mechanism). The contract package does NOT depend on arktype.
- The adapter interface SHALL declare `isAvailable(projectRoot: string): boolean | Promise<boolean>` — each adapter implements its own detection logic (e.g., checking for `.opencode/` directory, platform binary on PATH). The CLI uses this for auto-detection during platform selection.
- The adapter interface SHALL declare `assembleFrontmatter` as a method signature. Concrete implementation is stubbed in this change and deferred to the install pipeline.
- Each adapter SHALL export a typed config type (e.g., `OpenCodeConfig`) alongside its validation schema, enabling typed access for CLI tooling and programmatic consumers.
- All adapter packages are private workspace packages, compiled into the CLI binary at build time via `bun build --compile`. They are NOT published to npm and are NOT downloaded on-demand.
- Move platform validation out of `packages/core/src/build/validate-platforms.ts`. Core SHALL depend on `@agent-facets/adapter` for the interface and accept adapters as inputs rather than hardcoding platform knowledge. The build pipeline's `validatePlatformConfigs` function SHALL accept a set of registered adapters and delegate validation to each adapter's `validateConfig` method. Unknown platforms (those not matched by any registered adapter) SHALL produce a warning, preserving current behavior.
- `packages/cli` SHALL depend on the concrete adapter packages and wire them into core's pipeline. The CLI is the composition root — it imports all bundled adapters and passes them to core.
- Workspace configuration SHALL be updated to include `packages/adapters/*` in the workspace glob.

## Capabilities

### New Capabilities

- `adapters`: The plugin architecture for platform support — the adapter interface contract, adapter registration, platform detection, and the relationship between the contract package, adapter packages, core, and the CLI. This domain covers how platform knowledge is modularized and extended.

### Modified Capabilities

None. The build pipeline's platform validation behavior is unchanged from a requirements perspective — only the implementation source of platform schemas changes. This is an internal refactor of where validation logic lives, not a change to what the build pipeline promises to users.

## Non-Goals

- Install-time asset placement or directory writing — that belongs to the `local-install-pipeline` change, which consumes the adapters this change creates
- Frontmatter assembly implementation — the interface SHALL declare the method signature, but concrete implementation is deferred to the install pipeline change
- MCP server configuration or MCP runtime — MCP will be its own separate adapter/binary with stdio communication, not a platform adapter concern
- npm publishing of adapter packages — adapters are private, compiled into the CLI binary. The `@agent-facets/adapter` contract package MAY be published eventually for third-party use, but not in this change.
- Dynamic adapter loading or plugin discovery — adapters are statically imported and compiled into the binary
- Platform configuration files (`.facets/config.local.json`, `~/.config/facets/`) — that is a `local-install-pipeline` concern. The adapter interface provides `isAvailable()` for detection, but config persistence is not its responsibility.
- Tier 2 platforms (Cursor, Windsurf, Copilot, Codex) — only OpenCode and Claude Code for now

## Impact

- **New packages**: `packages/adapter/` (contract), `packages/adapters/opencode/`, `packages/adapters/claude-code/` added to the Turborepo monorepo with Bun workspaces. All three packages SHALL be marked `private: true`.
- **Workspace config**: Root `package.json` workspaces updated to include `packages/adapters/*`.
- **`packages/core`**: Depends on `@agent-facets/adapter`. `validate-platforms.ts` refactored to accept adapters rather than hardcode schemas. The `KNOWN_PLATFORMS` map and platform-specific arktype schemas are removed from core.
- **`packages/cli`**: Depends on `@agent-facets/adapter-opencode` and `@agent-facets/adapter-claude-code`. Imports concrete adapters and passes them to core's build pipeline. Adapters are bundled into the compiled binary.
- **Dependency graph**: `@agent-facets/adapter` ← `core`, `adapter-opencode`, `adapter-claude-code`. `cli` ← `core`, `adapter-opencode`, `adapter-claude-code`. No circular dependencies.
- **ADRs**: ADR-001 (Facet Manifest Schema) defines the `platforms` config block that adapters validate. ADR-003 (Install & Resolve Flow) states that directory mapping is a CLI concern — this change formalizes that by moving platform knowledge out of core and into adapter packages wired by the CLI.
- **Roadmap**: This is preparatory work for Phase 3 (Local Installation) at `../strategy/facets/roadmap/03-local-installation.md`, currently `planned`. This change alone does not complete the phase, so no status transition is expected.
