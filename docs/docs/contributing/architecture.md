---
title: Architecture
description: The three-layer architecture of Agent Facets  -- protocol, engine, CLI.
---

Agent Facets is organized as three layers, each with distinct responsibilities and runtime constraints. This page explains how the layers fit together and what belongs in each.

## The three layers

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

> Three layers, each with distinct responsibilities and runtime
> constraints. **`@agent-facets/protocol`** owns the artifact spec  --
> Node-native, public on npm, no services. **`@agent-facets/engine`**
> is the Bun-native CLI machinery  -- private to this monorepo, never
> published. **`agent-facets`** (the CLI) is the user-facing argv +
> Ink TUI surface that calls into engine. The cafe registry consumes
> protocol directly over its own OpenAPI surface; engine consumes
> cafe's OpenAPI as an HTTP client.

## Layer 1  -- `@agent-facets/protocol`

The TypeScript reference implementation of the **facet artifact specification**. This is the only package in the monorepo that is published to npm. It's Node-native (Node 22+), depends on no Bun-specific APIs, and has no service or network surface.

What lives here:

- **Schemas** for every facet artifact format: `facet.json`, `facets.json`, `facets.lock`, `build-manifest.json`, server manifest.
- **Bytes-validators** for those schemas  -- pure functions on `Uint8Array | string` that return either typed values or structured errors. No disk I/O.
- **Front-matter encoding**  -- extract/strip YAML front matter from asset bodies; this is part of the file-format contract.
- **Integrity verification**  -- registry three-check (lockfile / cache / archive-manifest / computed-content), git one-check (lockfile / computed). Pure functions on hash strings; no I/O.
- **Content hashing**  -- `computeContentHash`, the deterministic tar layout (`assembleTar`, `assembleOuterTar`, `collectArchiveEntries`, `computeAssetHashes`), and format constants (`INNER_ARCHIVE_NAME`, `BUILD_MANIFEST_NAME`, `DETERMINISTIC_ATTRS`). Tar bytes are part of the integrity contract; gzip output is not (compression is a delivery concern).
- **Archive readers**  -- `parseFacetArchive(bytes)` and `parseInnerArchive(innerTarBytes)` for consumers that need to read uploaded `.facet` bytes without writing them to disk.
- **Build validators** that encode artifact contract rules: `detectNamingCollisions`, `validateContentFiles`, `validateCompactFacets`.
- **Version-spec grammar**  -- the `VersionSpec` type, the regex grammar for `1.*` / `1.2.*` / exact / `*` / `latest`, and the `resolvesToLatest` matcher. Version specifiers appear in artifacts (`facets.json` and `facets.lock`), so the grammar is normative.

The protocol package is **the spec, implemented in TypeScript**. Other implementations of the same spec  -- a future Rust crate, a Go module, a Python library  -- would have their own equivalent. They would all produce byte-identical artifacts from identical inputs and accept the same artifacts from one another.

If an implementation in any language wants to be "facet-compatible," what it conforms to is described here.

## Layer 2  -- `@agent-facets/engine`

The Bun-native CLI machinery. **Private** to this monorepo; never published to npm. One concrete implementation of the facet specification on a developer's machine: install pipeline, registry HTTP client, adapter machinery, scaffold, edit, self-update, source resolvers, manifest mutations, cache, build pipeline orchestrator, gzip compression.

If we ever rewrote the engine in Rust for performance, every line in this package would be replaced  -- but the protocol it depends on would not. That's the test for what belongs here vs. what belongs in protocol.

What lives here:

- **Adapter machinery** -- bundling, install-service, placement, verify, loader, first-party list. Adapters are CLI-side abstractions over AI coding tools; the spec doesn't mandate adapters at all.
- **Adapter sources** -- npm tarball download, git clone, local path resolution. Subprocess-driven; engine-only.
- **Facet sources** -- git clone, local path resolution. Same shape as adapter sources.
- **Source-specifier parsers** -- `parseFacetSource`, `parseAdapterSpecifier`, `parseVersionSpec`. The CLI interprets user-input source strings; the parsed `Source` discriminant is engine-internal. Only the `VersionSpec` slice (which appears in published artifacts) lives in protocol.
- **Install pipeline orchestrator** -- plan/commit split: `prepareAdd`/`prepareRemove` produce a delta, `runInstall` is the commit orchestrator (resolution, integrity, materialization, transactional tri-write of manifest + lockfile + receipt). Journal for rollback.
- **Build pipeline orchestrator** -- `runBuildPipeline`, `writeBuildOutput`. Wires protocol's primitives (validators, content-hash, tar layout) into a CLI workflow with progress events.
- **`compressArchive`** -- gzip is delivery, not part of the integrity contract. Kept here so protocol stays gzip-implementation-agnostic.
- **Cache** -- `~/.facet/cache/` layout, identity computation, atomic put, lookup, self-audit on every hit (content re-hashed against sidecar; tampered slots evicted). Developer-machine state.
- **Install receipt** -- `~/.facet/receipts/` per-project machine-local record of materialized state, separate from the lockfile. Drives offline drift removal (orphan-on-pull cleanup).
- **Manifest mutations + project-files I/O** -- the JSON rewrites for `facets.json` and the disk bridge that reads/writes it. Each CLI has its own mutation semantics; the spec only constrains the file's shape (which lives in protocol).
- **Registry client** -- HTTP I/O against the registry server, archive download/extract.
- **Edit** -- interactive reconcile, scanner, manifest-writer, edit operations.
- **Scaffold** -- `facet create` machinery.
- **Self-update** -- detect install method, run the right updater (npm/pnpm/yarn/bun/curl).
- **Path-based loaders** -- `loadManifest(dir)`, `resolvePrompts(rootDir)`, `loadServerManifest(filePath)`. Thin wrappers over Bun's filesystem primitives that read bytes and call protocol's bytes-validators.

## Layer 3  -- `agent-facets` (the CLI)

The display and entry-point layer. Argument parsing, Ink-based TUI views, error formatting, exit-code mapping. **Private** to this monorepo; published as the binary, but the source isn't an importable library.

The CLI imports from both `@agent-facets/protocol` (for data primitives) and `@agent-facets/engine` (for orchestrators and services). It does not implement business logic itself  -- every substantive operation is implemented in engine and presented by the CLI.

## Why the registry HTTP API is not in protocol

A common question: if the CLI talks to a registry, shouldn't the wire format be part of the protocol package?

**No.** The protocol describes **data at rest**  -- what facets look like as artifacts. **Service interactions** (CLI ↔ registry over HTTP, for example) are owned by the service whose API surface they describe.

The registry (`facet-cafe`) publishes its own OpenAPI specification. The CLI consumes that specification via build-time codegen  -- `bun run --cwd packages/engine codegen:registry` vendors a snapshot and regenerates the typed module. This separation lets the registry HTTP API and the artifact format evolve on independent cadences. Adding a registry endpoint doesn't bump protocol semver; revising a manifest schema doesn't bump the registry's API version.

This is also why a future date-versioned API model is straightforward to adopt: the registry publishes `/openapi/v0?date=2026-04-22`, the CLI pins a date in its source, and clients with different pins continue to work against the same registry.

## Why this matters

Three properties fall out of the layering:

1. **Third-party tooling can be built against the protocol.** Anything that handles `.facet` artifacts  -- a registry server, an offline linter, a vendor's CI tool  -- depends on `@agent-facets/protocol` and only that. It doesn't pull in the CLI's machinery, doesn't need Bun, doesn't accidentally import gzip or subprocess code.

2. **Engine is replaceable.** A team that wanted a faster CLI in Rust (or a CLI in another language entirely) could write a new engine without changing the spec. As long as the new engine produces byte-identical archives and respects the same integrity rules, it's facet-compatible.

3. **The spec evolves on its own clock.** Protocol changes are versioned semantically and signal real artifact-contract changes. Engine changes are versioned independently and signal CLI workflow changes. The CLI binary pins both  -- when shipping a release, you know exactly which protocol version it conforms to and which engine implementation it runs.
