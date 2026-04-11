## Why

Facet authors can build facets today, but consumers have no way to install and use them. The authoring-to-consumption loop is broken — facets are write-only artifacts. This change introduces the local install pipeline: the commands and infrastructure needed for a user to add a facet from a local source, restore installed facets from a lockfile, and configure which AI coding platform they use.

The install pipeline is designed around the assumption that `facet add <specifier>` is the primary entry point. The specifier format determines the resolution strategy — a path resolves locally, a bare name resolves from the registry. This change implements the local path resolver; the registry resolver is stubbed. The architecture is built so registry support slots in later without changing the downstream pipeline.

## What Changes

- New `facet add <specifier>` command that resolves a facet from a specifier, runs a review TUI, places text assets into the correct platform directories using the platform adapter from `platform-adapter-architecture`, caches the archive globally, and updates `facets.lock`. Specifier parsing lives in `packages/core` and determines the resolution strategy by argument shape: a path (contains `/` or `.`) resolves locally from a self-contained `.facet` file; a bare name (with optional `@version`) resolves from the registry (stubbed for now, returns an error directing users to provide a local path).
- New `facet install` command (no arguments) that reads `facets.lock` and restores all facet assets to their platform directories — pulling from the global cache. This is the deterministic restore operation, analogous to `bun install` / `npm install` with no args. If a facet is not in the global cache and no registry client is available, it SHALL error with a clear message.
- New `facet init` command that initializes platform configuration, setting up `~/.config/facets/config.json` (user-level) and/or `.facets/config.local.json` (project-level).
- Two-level configuration system: user-level defaults at `~/.config/facets/config.json`, project-level overrides at `.facets/config.local.json` (gitignored), deep-merged at runtime. Primary config value is `platform` (`opencode` | `claude-code`), which selects which `PlatformAdapter` is active for the project.
- Global cache at `~/.facets/cache/` where `.facet` archives are stored after add for future restore, override reset, and reinstall operations.
- Lockfile writing on `facet add`: records facet name, version, integrity hash, and per-asset content hashes.
- Lockfile-driven restore on `facet install`: reads `facets.lock`, checks asset placement, pulls from cache if needed.
- Install-time review TUI for `facet add`: shows a summary of assets being installed (names, types, counts) with accept-all confirmation.
- `facet add` SHALL prompt for platform selection inline if no platform is configured anywhere. `facet init` SHALL also exist as a standalone setup command.
- `facet add` with no arguments SHALL be an error — a specifier is always required.

## Capabilities

### New Capabilities

- `platform-config`: Platform configuration cascade (user-level at `~/.config/facets/config.json` + project-level at `.facets/config.local.json` with deep merge), platform selection (mapping configured platform name to the correct `PlatformAdapter`), and the `facet init` initialization command. This does NOT cover the adapter interface or adapter packages themselves — those are established by the `platform-adapter-architecture` change.
- `caching`: Global cache management — storing `.facet` archives at `~/.facets/cache/`, cache lookup by name+version, and cache integrity verification

### Modified Capabilities

- `installation`: Adding the add and restore flows — specifier parsing and resolution, reading self-contained `.facet` archives (outer tar with `build-manifest.json` + inner `archive.tar.gz`), extracting assets, placing text assets via platform adapters, writing per-asset content hashes to the lockfile, and lockfile-driven restore. The existing spec covers lockfile structure only; this adds the behavioral requirements for `facet add` and `facet install`.
- `cli`: Registering the `add`, `install`, and `init` commands with their argument parsing, flags, and help text

## Non-Goals

- Platform adapter interface or adapter packages — that is the `platform-adapter-architecture` change
- Registry client or remote downloads — specifier parsing supports bare names but the registry resolver is stubbed. Registry support is Phase 7.
- MCP server resolution or server entries in the lockfile (Phase 5)
- Upgrade flow, version diffing, or `facet update` (Phase 6)
- Override detection, patch storage, or 3-way merge — the lockfile records per-asset hashes as a foundation, but the override system is a separate change
- Per-asset accept/reject at install time — the MVP review UX is summary + accept-all
- Collision detection with existing unmanaged assets — deferred to a follow-up
- `facet remove` command — natural follow-up but not part of this change
- Tier 2 platform support (Cursor, Windsurf, Copilot, Codex)

## Impact

- **`packages/core`**: New modules for specifier parsing, config loading/merging, cache management, archive extraction, and lockfile read/write. Extended lockfile schema with per-asset content hashes. New `.facet` archive reader (extract outer tar, read `build-manifest.json`, decompress inner `archive.tar.gz`). Uses the `PlatformAdapter` interface from `@agent-facets/platform-api` for asset placement.
- **`packages/cli`**: New `add`, `install`, and `init` command implementations with TUI views. The `add` command hosts the review flow; `install` is non-interactive. Wires the configured platform adapter into the pipeline.
- **Filesystem**: Creates `~/.config/facets/` (user config), `~/.facets/cache/` (global cache), `.facets/` (project config) directories. Writes `facets.lock` to the project root. Places text assets into platform-specific directories via the active `PlatformAdapter`.
- **Dependencies**: This change depends on two completed prerequisite changes:
  - `self-contained-archive` (completed) — the `.facet` archive format that `facet add` reads
  - `platform-adapter-architecture` — the `PlatformAdapter` interface and concrete adapter packages that `facet add` and `facet install` use for asset placement and frontmatter assembly
- **ADRs**: ADR-003 (Install & Resolve Flow) defines the install steps, lockfile semantics, and the principle that directory mapping is a CLI concern. ADR-004 (Integrity Model) defines content hash computation and per-asset verification. ADR-001 (Facet Manifest Schema) defines the platform config shape validated at build time.
- **Roadmap**: Corresponds to Phase 3 (Local Installation) at `../strategy/facets/roadmap/03-local-installation.md`, currently `planned`. Phase MUST be transitioned to `active` before implementation begins.
