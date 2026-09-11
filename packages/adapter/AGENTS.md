# `@agent-facets/adapter`

## What this package is

The published adapter SDK. It defines the contract an adapter package
implements to teach the facet pipeline about one AI coding tool. Every
adapter ships a `defineAdapter({...})` call; `engine` loads it at
install time.

Third-party adapter authors install this package. That constrains
everything below.

## Adapters plan; they never write

This is the central idea of the SDK, and the thing most likely to be
got wrong. `planInstall` and `planRemoval` return a `FileMutation[]`
describing exact `A → B` per-file transitions. They do not touch the
filesystem. Engine's transaction (`packages/engine/src/fs/`) is the
only thing that commits a plan.

Concretely, that means an adapter:

- returns a plan even when nothing needs to change (a no-op mutation),
- carries the exact bytes it *expected* to find, so the transaction can
  detect a file that changed under it between plan and commit,
- reports failure as a returned discriminated union, never a throw.

Helpers here exist to make planning correct, not to perform I/O:
`planSingleFileInstall`, `planSingleFileRemoval`,
`planSkillBundleInstall`, `planSkillBundleRemoval`, `readFileState`,
`assembleAssetContent`, `splitAssetContent`.

## What belongs here

- **`defineAdapter`** and the types an adapter must satisfy
  (`Adapter`, `AssetCapability`, `McpServerCapability`, the
  plan-request/result shapes).
- **Planning helpers** an adapter author calls at runtime — single-file
  and skill-bundle planners, file-state reading, content assembly and
  front-matter splitting, contained-path validation.
- **MCP server support** — the declaration types, reconciliation
  (`reconcileMcpServers`), the text-document plan preparation
  (`prepareMcpTextPlan`, `readTextOrAbsent`, interpolation guards), and
  the native-value comparison helpers adapters use to decide whether a
  tool's existing entry matches what a facet declares.
- **`./api-version`** — `ADAPTER_API_VERSION` and
  `ADAPTER_API_VERSION_PACKAGE_FIELD`. A separate, dependency-free
  entry point so a consumer can read the constant without loading the
  SDK's module graph. Engine checks it in
  `packages/engine/src/adapters/api-compatibility.ts`; `scripts/prepack.ts`
  stamps it into every published adapter's manifest.
- **`./terminal`** — canonical escaping for rendering a command line,
  an environment assignment, or a literal into a tool's config.

The public surface is `src/index.ts`. Read it rather than trusting a
list in this file.

## What does NOT belong here

- **Any dependency on `engine` or `cli`.** Hard rule. Engine imports
  adapters, so the reverse edge is a cycle. If you want something from
  engine, either the primitive belongs in `common`, or the adapter
  contract needs a new field so engine can supply the value.
- **Filesystem writes, subprocesses, or network calls.** An adapter
  never launches, connects to, health-checks, or authenticates a
  server. It reads to plan, and returns the plan.
- **Facet-pipeline business logic.** Source parsing, cache layout,
  lockfiles, integrity — `engine` and `protocol` own those.
- **Heavy runtime dependencies.** Every entry in `dependencies`
  becomes a transitive dependency for every adapter consumer.
  Currently there is exactly one: `yaml`.

## Bundling and the boundary with `common` / `protocol`

`tsdown.config.ts` inlines **two** workspace packages into the
published artifact: `@agent-facets/common` and
`@agent-facets/protocol`. Neither appears in a consumer's dependency
tree.

- `common` supplies the shared file-state and mutation vocabulary
  (`FileState`, `FileMutation`, `bytesEqual`, `regularFile`), which
  this package re-exports so an adapter author gets it from one place.
  `inspectFileState` is deliberately *not* re-exported — its signature
  names `node:fs`'s `Stats`, which would leak a Node type into the
  published declarations. Plan through `readFileState` instead.
- `protocol` contributes only `McpServerDeclaration`, imported from its
  dedicated `@agent-facets/protocol/mcp-declaration` subpath. That
  subpath exists precisely so none of protocol's runtime graph
  (arktype, nanotar, yaml) reaches this package's emitted JavaScript or
  declarations. `src/__tests__/dist.e2e.test.ts` pins that invariant —
  if it fails, something started importing protocol's main entry.

One caution recorded in `tsdown.config.ts`: `alwaysBundle` is
deliberately the single top-level list. Setting `deps.dts.alwaysBundle`
*replaces* it for declaration importers rather than extending it, which
silently re-externalizes `common`.

## Rule of thumb

Before adding a file here, ask: "Does an adapter author need to call
this at runtime to implement a working adapter?" If yes, it belongs
here. If it is about *running* an install rather than implementing the
adapter contract, it belongs in `engine`.
