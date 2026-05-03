## Why

The registry server (`facet-cafe`) needs to validate and verify uploaded `.facet` archives from AWS Lambda on Node 24, but the package containing those primitives — `@agent-facets/core` — uses Bun-only APIs throughout (`Bun.file`, `Bun.gzipSync`, `Bun.CryptoHasher`, `Bun.spawn`, `Bun.build`) and cannot run on Node.

Behind that immediate need is a design problem: `@agent-facets/core` conflates **the artifact specification** (schemas, integrity rules, deterministic archive format, hash algorithm) with **the CLI's machine-bound implementation of it** (subprocess-driven adapter bundling, registry client, install pipeline, scaffold, edit, self-update). The first is portable Node-runnable data + cryptography any third party MUST honor. The second is intrinsically Bun-native and runs only on a developer's machine. Splitting them lets the specification ship as a dedicated package and lets future implementations evolve independently.

## What Changes

- **NEW**: `@agent-facets/protocol` — published, Node-native, the reference implementation of the **facet artifact specification**: schemas, validation, integrity verification, deterministic archive format, hash algorithm, version-spec grammar, and front-matter encoding. Pure data + cryptography. No subprocesses, no network, no developer-machine state.
- **BREAKING**: `@agent-facets/core` renamed to `@agent-facets/engine` and made private. Engine hosts the Bun-native CLI machinery (adapter bundling, install pipeline, registry client, cache, scaffold, edit, self-update, source resolvers, manifest mutations) and consumes `@agent-facets/protocol` for data primitives.
- **BREAKING**: `@agent-facets/core` is no longer published; frozen at v0.9.1. No npm deprecation message added (closed-alpha, no known external consumers).
- The CLI's internal imports split between `@agent-facets/protocol` (data types, schemas, integrity) and `@agent-facets/engine` (orchestrators, pipelines, services).
- Engine internals are NOT cleaned up. Engine remains Bun-native because the CLI runs on Bun. Only the protocol slice ports to Node.
- New contributor-facing architecture page (`docs/docs/contributing/architecture.md`) explains the three-layer system.

## Architecture

The end state is three layers with a clean dependency direction. The `protocol` package is the only published library; `engine` and the CLI are private to the monorepo.

```
┌─────────────────────────────────────────────────────────────────┐
│                    @agent-facets/protocol                       │
│                  (Node-native, public, npm)                     │
│                                                                 │
│   The artifact specification. Pure data + crypto + bytes.       │
│   No services, no network, no machine state.                    │
│                                                                 │
│   ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐     │
│   │   schemas    │  │ content-hashing  │  │  integrity   │     │
│   └──────────────┘  └──────────────────┘  └──────────────┘     │
│   ┌──────────────┐  ┌──────────────────┐                       │
│   │ front-matter │  │   version-spec   │                       │
│   └──────────────┘  └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                          ▲             ▲
                          │             │
        ┌─────────────────┘             └────────────────┐
        │                                                │
┌───────────────────────┐                  ┌─────────────────────────┐
│  @agent-facets/engine │                  │      facet-cafe         │
│  (Bun, private)       │                  │  (the registry server)  │
│                       │                  │  Lambda on Node 24      │
│  - install pipeline   │                  │                         │
│  - registry client    │  ─── HTTP ──▶    │  Validates uploads      │
│  - cache              │  (consuming      │  Stores artifacts       │
│  - adapter machinery  │   cafe's         │  Serves metadata        │
│  - scaffold/edit      │   OpenAPI)       │                         │
│  - self-update        │                  │  Owns its OpenAPI spec  │
│  - source resolvers   │                  │  (eventually dated)     │
└───────────┬───────────┘                  └─────────────────────────┘
            │
            ▼
┌───────────────────────┐
│  agent-facets (CLI)   │
│  (Bun, private)       │
│                       │
│  - argv + Ink TUI     │
│  - error formatting   │
│  - exit codes         │
└───────────────────────┘
```

Two design decisions worth surfacing here because they shape every downstream artifact:

**Protocol describes data at rest, not data in motion.** The protocol package is purely about the artifact format — what's on disk, what's in S3, what's in a `.facet` archive. Service interactions (CLI ↔ registry) are owned by the service whose API surface they describe. The registry will publish its own OpenAPI specification (eventually date-versioned, e.g. `/openapi/v0?date=2026-04-22`); the CLI consumes that spec separately rather than baking the wire format into the protocol package. This lets the registry API and the artifact format evolve on independent cadences.

**The "protocol" capability is decomposed into independent sub-domains.** The artifact specification is not one thing — it is five distinct contracts, each of which a third party could need without the others (a registry validating uploads needs schemas; a content-aware mirror needs integrity verification; an SDK reading asset files needs front-matter encoding). Each becomes its own spec under the `protocol__` category prefix.

## Capabilities

### New Capabilities

- `protocol`: The meta-spec defining what facet-compatibility means as observable behavior, how protocol requirements evolve over time (semver discipline within a major version), and the relationship between the published reference implementation and the protocol's normative requirements. This is the cross-cutting contract that ties the sub-specs together; without it, "facet-compatible" has no formal meaning.
- `protocol__schemas`: The arktype/JSON definitions of every facet artifact format — `facet.json`, `facets.json`, `facets.lock`, `build-manifest.json`, server manifest. Any system that produces or consumes facet artifacts MUST validate against these schemas.
- `protocol__integrity`: The integrity-verification algorithm — registry three-check (lockfile / cache / archive-manifest / computed-content) and git one-check (lockfile / computed). Any system distributing or installing facets MUST run these checks before trusting an artifact.
- `protocol__front-matter`: The YAML front-matter encoding rule for asset files (skills, agents, commands). Any system reading or composing facet asset files MUST honor this encoding.
- `protocol__version-spec`: The grammar of version specifiers (`1.*`, `1.2.*`, exact versions, `*`/latest) as they appear inside `facets.json` and `facets.lock`. Any system that interprets a lockfile or project manifest MUST honor this grammar.

### Modified Capabilities

- `protocol__content-hashing` (renamed from `content-hashing`): The hash format (`sha256:<hex>`) and the deterministic archive layout (entry sort order, fixed metadata) that drive integrity. Renamed and reframed under the `protocol__` category to make explicit that these rules are normative for any facet-compatible system, not just internal CLI behavior. Scenarios are unchanged; the Purpose section is updated to reflect the third-party-honored framing.
- `distribution`: Currently scoped to the CLI binary's per-platform packaging. Adds requirements describing how `@agent-facets/protocol` is published (public, Node-runtime-compatible) and how the legacy `@agent-facets/core` package stops being published (frozen at v0.9.1). Also updates one scenario that names `@agent-facets/core` as an example to use a different placeholder package name.

Note: The `installation` and `cli` specs were originally listed as modified, but on review they describe user-observable behavior in spec-governance-compliant terms and contain no references to internal package names. They do not require deltas in this change. Internal package-name references in their *implementation* are updated as part of the change's scope (per Documentation referenced section), but the *specs themselves* do not change.

## Non-goals

- **Porting the engine package's Bun usage to Node.** Engine remains Bun-native; the CLI runs on Bun. Only the protocol package is ported.
- **Cleaning up engine internals** (subprocess style, `Bun.file` calls, `Bun.gzipSync` use). Out of scope — engine is private and untouched internally.
- **Specifying the registry HTTP API.** The registry owns its own OpenAPI specification (eventually date-versioned); this change does not place it in the protocol.
- **Setting up OpenAPI codegen for the registry client.** The registry SHOULD be the source of truth for the wire format, and the CLI SHOULD eventually generate types from its published OpenAPI rather than hand-coding them. Doing so is a follow-up change. The CLI's existing hand-coded `registry-client.ts` types stay as-is during this refactor.
- **Building third-party reference implementations** (Rust CLI, alternative registry server). The protocol package enables them; building them is future work.
- **Breaking the install pipeline, build pipeline, or any user-visible CLI behavior.** This is a structural refactor; behavior is unchanged.
- **Migrating the facet-cafe consumer in this change.** Cafe adoption happens after `@agent-facets/protocol` is published.
- **Splitting tests onto `node:test`.** Tests stay on `bun:test` in both packages.

## Documentation referenced

This change touches existing documentation in several places and introduces one new contributor-facing page:

- `README.md` (root) — currently lists `@agent-facets/core` in the Packages table; MUST be updated to list `@agent-facets/protocol` (public, the artifact specification) and remove the legacy `core` row.
- `docs/docs/contributing/release-pipeline.md` — references `@agent-facets/core` in the publishing pipeline; MUST be updated to describe `@agent-facets/protocol` as the new published library.
- `docs/docs/contributing/architecture.md` — **NEW**. A contributor-facing page explaining the three-layer architecture (protocol / engine / CLI), with the diagram from this proposal as the centerpiece, plus the design rationale for keeping registry wire format outside the protocol. Lives under `Contributing` because it describes the codebase shape, not user-visible behavior.
- `docs/docs/learn/index.md` — currently references `core`; MUST be updated. Note: the user-facing "Key Concepts" page does NOT need to know about the engine/protocol split (that's a contributor concern), but any prose mentioning `@agent-facets/core` MUST be corrected.
- `openspec/specs/distribution/spec.md` — defines distribution requirements; MUST be extended for library-package distribution alongside the existing CLI-binary requirements.
- `openspec/specs/content-hashing/spec.md` — directory MUST be renamed to `openspec/specs/protocol__content-hashing/`. Scenarios unchanged; Purpose reframed.
- `openspec/specs/installation/spec.md` and `openspec/specs/cli/spec.md` — internal package-name references MUST be updated.
- `packages/core/AGENTS.md` and `packages/cli/AGENTS.md` — describe layer responsibilities; MUST be replaced (engine gets a new `AGENTS.md` reflecting Layer 2 role) and updated (cli) to reflect the new three-layer architecture. A new `packages/protocol/AGENTS.md` MUST be created describing Layer 1.

## Impact

- **Workspace**: `packages/protocol/` (new, public, Node-native) added; `packages/engine/` (renamed from `packages/core/` via `git mv`, made private, depends on protocol).
- **Code migration**: ~30 source files move from `core/src/` into `protocol/src/`; ~50 remaining engine files update internal imports to `@agent-facets/protocol`.
- **External references**: 62 `@agent-facets/core` mentions across CLI source, scripts, tests, root `README.md`, AGENTS.md files, docs, and openspec specs are rewritten.
- **Release pipeline**: `.changeset/config.json` linked-version groupings updated; `scripts/release/publish.ts` verified package-name-agnostic. CI publishes `@agent-facets/protocol@0.1.0` on its first version tag.
- **npm**: `@agent-facets/core` frozen at v0.9.1; new consumers MUST use `@agent-facets/protocol`.
- **Consumer surface**: Third-party Node consumers (starting with `facet-cafe`) gain a Node-runtime-compatible package usable from Lambda or any Node environment.
- **Future evolution unlocked**: Protocol describes artifact format only; registry HTTP API can evolve on its own cadence without protocol breakage, and vice versa.
