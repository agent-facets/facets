<CircleCI>

## CircleCI Project

| Key            | Value                                         |
| -------------- | --------------------------------------------- |
| Project Name   | facets                                        |
| Project Slug   | `circleci/TXx3MQGFf8BTw9fgSHwVWi/RfHfmwgTVFBrv4ZDBMMifk` |
| Git Remote URL | `git@github.com:agent-facets/facets.git`       |
| Default Branch | `main`                                        |

</CircleCI>

<SST>

## SST

This repo hosts `agentfacets.io` via SST. The SST app name is `agent-facets`. The AWS
account is shared with the sibling `facet-cafe` repo.

| Key            | Value                                              |
|----------------|----------------------------------------------------|
| App name       | `agent-facets`                                     |
| AWS profile    | `facet-cafe` (shared account)                      |
| Node runtime   | `nodejs24.x` (matches `mise.toml` — single source) |
| Main stage     | `main` → `agentfacets.io` (apex) + WAF             |
| Preview stage  | `${stage}` → `${stage}.agentfacets.io`, no WAF     |
| Personal stage | `${user}` → `${user}.agentfacets.io`, no WAF       |

### Prerequisites

- **mise** must be active. `mise.development.toml` sets `AWS_PROFILE=facet-cafe` for
  local development. There is no `.env.local`.
- `bun install` runs `sst install` automatically (skipped in CI).

### Commands

| Command                          | What it does                          |
|----------------------------------|---------------------------------------|
| `bun sst dev`                    | SST dev mode for current `$SST_STAGE` |
| `bun sst deploy --stage <stage>` | Deploy to a named stage               |
| `bun sst remove --stage <stage>` | Tear down a non-main stage            |

### Continuous deployment

Every push to `main` runs `sst deploy --stage main` via the `deploy` workflow
in `.circleci/release/workflows/deploy.yml`. Requires the `sst` CircleCI
context with `AWS_ROLE_ARN`. See `scripts/deploy/README.md` for the pipeline
flow and [CircleCI's AWS OIDC docs][oidc-aws] for the one-time IAM setup.

[oidc-aws]: https://circleci.com/docs/guides/permissions-authentication/openid-connect-tokens/#set-up-aws

Manual deploys are still supported for ad-hoc stages via the `bun sst deploy
--stage <stage>` command.

### Layout

- `sst.config.ts` at repo root.
- `infra/` contains infra modules auto-imported by `sst.config.ts`.
- `infra/tsconfig.json` scopes TypeScript for infra code (extends SST's platform config).
- `packages/landing/` is the Vite + React landing site served from apex.
- `packages/functions/` hosts Lambda handlers (currently `src/install.handler`).

### DNS

- `agentfacets.io` A → SST-managed CloudFront (apex).
- `www.agentfacets.io` → 301 to apex via SST `domain.redirects`.
- `docs.agentfacets.io` CNAME → Mintlify custom-domain target (managed by SST in
  `infra/dns.ts`).

</SST>

## Source Code Map

Turborepo monorepo with Bun workspaces. Six packages under `packages/`,
organized as a three-layer architecture (protocol / engine / CLI).

### `packages/protocol` — `@agent-facets/protocol` (Layer 1)

The TypeScript reference implementation of the **facet artifact specification**.
Public, Node-native (Node 22+), the only thing in this monorepo that gets
published to npm. Contains the schemas, bytes-validators, integrity
verification, deterministic archive format, hash algorithm, version-spec
grammar, front-matter encoding, and pure build validators.

If we rewrote engine in another language tomorrow, every line in protocol
would survive untouched — that's the test for what belongs here. See
`packages/protocol/AGENTS.md` for the full rules.

```
src/
├── schemas/        # Arktype schemas (facet, project, lockfile, build, server)
├── loaders/        # Pure bytes-validators: validateFacetManifest, validateServerManifest, resolvePromptsFromMap
├── integrity/      # 3-check + 1-check verification, IntegrityResult types
├── build/          # Pure: detect-collisions, validate-content, validate-facets, content-hash, parseFacetArchive
├── sources/        # Just version-spec.ts (VersionSpec type + grammar + resolvesToLatest)
├── front-matter.ts # YAML front-matter extract/strip
├── index.ts        # Curated public API
└── __tests__/      # Tests run on bun:test (devDep), but src/ runs on Node
```

### `packages/engine` — `@agent-facets/engine` (Layer 2)

The Bun-native CLI machinery. Private to this monorepo; never published.
One concrete implementation of the spec on a developer's machine. Other
implementations (a future Rust CLI, the cafe registry server) would have
their own engine equivalent. Engine consumes `@agent-facets/protocol`
for everything that's part of the spec.

If you'd rewrite this code in Rust as part of porting the CLI, it
belongs here.

```
src/
├── adapters/       # Adapter machinery: bundler, placement, verify, loader, install-service, first-party list
├── sources/        # Source resolvers: parse + clone/fetch (facet + adapter), Source type, ParseError
├── install/        # Install machinery: journal, lockfile-guard, lockfile-io, materialize, run-install orchestrator
├── cache/          # ~/.facets/cache/ — content-addressed cache for fetched facet payloads
├── manifest/       # Pure JSON mutations + project-files I/O bridge for facets.json
├── registry/       # Registry HTTP client: metadata resolution, download/extract, version-spec rendering
├── scaffold/       # Scaffold generator: `facet create` machinery
├── self-update/    # Detect install method, run the right updater
├── edit/           # Edit context: reconcile, scanner, manifest-writer, context, operations
├── build/          # Build pipeline orchestrator (pipeline.ts, write-output.ts) + compress.ts (gzip — delivery only)
├── loaders/        # Path-based loader wrappers that read disk and call protocol's bytes-validators
└── index.ts        # Curated engine-specific exports — do not re-export protocol
```

A note on duplication: `sources/facet/` and `sources/adapter/` each have
their own parser and git-clone helper today. They started life on the CLI
side and were lifted to engine as-is. Consolidating them into one
parameterized resolver is a deliberate follow-up — the rules differ today
(facet sources enforce project-tree containment; adapter sources don't),
and a unified API would need to make that variation explicit.

### `packages/cli` — `agent-facets` (Layer 3)

CLI binary (`facet`). Thin orchestration layer over `@agent-facets/protocol`
(data primitives) and `@agent-facets/engine` (CLI workflows): command
bindings, Ink-based TUI views, error formatting for the terminal.
Entry point: `src/index.ts`

```
src/
├── commands/       # Command bindings: add, adapter, build, create, edit, install, self-update
├── tui/            # Ink components, hooks, layouts, views, theme, gradient, editor
├── util/           # CLI presentation helpers (errors.ts → 3-line stderr format)
├── cli.ts          # CLI entry point used by the run loop
├── run.ts          # Top-level argv → command dispatch
├── help.ts         # Help rendering
├── commands.ts     # Command registry + alias resolution
├── version.ts      # Build-time version constant
├── suggest.ts      # "did you mean?" suggestions
├── index.ts        # Process-level entry (handles unhandled errors, exit codes)
└── __tests__/      # End-to-end tests + a few cross-cutting unit tests
```

### `packages/adapter` — `@agent-facets/adapter`

Adapter SDK for defining abstractions over AI coding tools. Entry point: `src/index.ts`

```
src/
├── define-adapter.ts  # Factory function: defineAdapter()
├── types.ts           # Adapter types
└── index.ts           # Public API entry point
```

### `packages/brand` — `@agent-facets/brand`

Brand colors and visual identity constants.

### `packages/common` — `@agent-facets/common`

Shared primitives that cross the core / adapter SDK / CLI boundary: cross-cutting types
(`AssetType`, `Scope`, `Validated`) and pure helpers with no heavy dependencies
(asset-name validation, text normalization, atomic file writes). Private — not
published to npm. `@agent-facets/adapter` bundles `common` into its build via
tsdown's `alwaysBundle` so the published SDK has no runtime dependency on
`common`; `core` and `cli` import it normally as a workspace dependency.

See `packages/common/AGENTS.md` for the rule on what does and doesn't belong here.

### Other directories

| Directory       | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `docs/`         | Mintlify documentation site                          |
| `scripts/`      | Repo-level utility scripts                           |
| `openspec/`     | OpenSpec change management (specs, schemas, changes) |

## Strategy

Strategic Decision Records (SDRs) and Architectural Decision Records (ADRs) live in Notion. The authoritative databases and views are configured in `.opencode/notion.json` (keys: `sdrs`, `sdr_events`, `sdr_relationships`, `adrs`, `adr_events`). Consult these when you need strategic or architectural context for decisions affecting this project. See also Article III of `openspec/config.yaml` for ADR authority.

## Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bun <package> <command>` instead of `npx <package> <command>`
- You MUST run OpenSpec commands with `bun openspec ...` not `npx openspec ...`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Errors are values, not control flow

**Do not throw errors to model expected outcomes.** Return discriminated
union results instead. Throwing is for genuinely unexpected, unrecoverable
conditions (programmer bugs, environment-level failures the function has
no contract for). Anything a caller can reasonably handle — validation
failures, missing files, cache misses, integrity mismatches, parse
errors, lock contention — is part of the function's *contract* and
belongs in its return type.

This is not a stylistic preference. Thrown errors are invisible to the
type system: TypeScript cannot tell you which functions throw, what they
throw, or whether you handled it. Result types make every failure mode
a static obligation — the compiler refuses to let you forget a case.

### The pattern

```ts
// Bad — failure is invisible to the type system; caller may forget
// to handle it; the throw is a side channel that bypasses the return
// type entirely.
export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    throw new ConfigNotFoundError(path)
  }
  // ...
}

// Good — failure is part of the contract. The compiler forces the
// caller to discriminate before reaching the success data.
export type LoadConfigResult =
  | { ok: true; config: Config }
  | { ok: false; reason: 'not-found'; path: string }
  | { ok: false; reason: 'invalid'; errors: ValidationError[] }

export function loadConfig(path: string): LoadConfigResult {
  if (!existsSync(path)) {
    return { ok: false, reason: 'not-found', path }
  }
  // ...
}
```

Failure data is **pure data**: a struct describing what went wrong, with
the fields a caller (or a UI layer) needs to render or branch on. No
`Error` instance, no stack trace, no message string the caller has to
parse.

### Canonical examples in this repo

Match these shapes. Do not invent new patterns.

- `packages/core/src/integrity/types.ts` — `IntegrityResult`,
  `IntegrityFailure`. Pure-data failure shape; no thrown errors.
- `packages/core/src/install/lockfile-io.ts` — `LoadLockfileResult` as
  `{ ok: true; data; existed } | { ok: false; error }`.
- `packages/core/src/install/run-install.ts` — `PlanFacetResult` and the
  larger `RunInstallResult` discriminated union. Failures are typed by
  `code` discriminator with structured fields per code.
- `@agent-facets/common`'s `Validated<T>` type — the project-wide alias
  for "validated payload or list of errors."

### When throwing is correct

- **Programmer bugs and invariant violations**: an `assertNever` exhaustiveness
  check in a `switch` over a tagged union. Reaching that arm is a bug;
  the throw is a debug aid, not a control-flow mechanism.
- **Environment failures the function never claimed to handle**: out of
  memory, the JS engine crashing, a syscall returning something the
  TypeScript types swore couldn't happen. These are the throws library
  authors *catch and convert into result types* at the boundary.
- **Inside try/catch wrappers that immediately convert to result types**:
  e.g., `try { JSON.parse(s) } catch { return { ok: false, ... } }`. The
  throw is internal; it never escapes the function. The function's
  *contract* is still result-shaped.

### Anti-patterns to refuse

- **"I'll just throw a typed error class"**: still invisible to the type
  system, still a side channel. A `class FooError extends Error` does
  not solve the problem; it just makes the throw feel structured. Use a
  discriminated union member instead.
- **"The caller can wrap it in try/catch"**: pushing failure handling
  into runtime checks the compiler can't verify. The whole point of
  TypeScript is to make this kind of obligation static.
- **"It's only for *exceptional* cases"**: every codebase that has ever
  said this has, three years later, contained dozens of `try { ... } catch (e) { /* swallow */ }` blocks. If the failure mode is part of the
  function's contract, it goes in the return type. "Exceptional" is in
  the eye of the caller.
- **Mixed contract — sometimes returns, sometimes throws**: pick one. If
  any failure mode in a function returns a result, all of them should.

### When you spot a throw in a code review

If a function throws something a caller might reasonably want to handle:
flag it. Convert it to a result type. The diff is mechanical; the type
system improvement is permanent.

## Testing

Use `bun check` to run tests, linting, and typeschecking.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Awaiting async expectations

Bun's `expect(...).rejects.<matcher>` and `expect(...).resolves.<matcher>` return promises. You **MUST** `await` the entire expression (or `return` it from the test). Without the outer `await`, Bun's test runner sees a synchronous return, the assertion promise never settles in scope, and a failing assertion silently passes — the test appears green but provides no guarantee.

The same rule applies to any promise-returning matcher.

**Correct** — the outer `await` makes the assertion actually run:

```ts
test("should handle async errors", async () => {
  await expect(async () => {
    await fetchUser("invalid-id");
  }).rejects.toThrow("User not found");
});
```

**Wrong** — no outer `await`. This test passes even when `fetchUser` doesn't throw:

```ts
test("should handle async errors", async () => {
  expect(async () => {
    await fetchUser("invalid-id");
  }).rejects.toThrow("User not found");
});
```

The same rule applies to `.resolves.*`:

```ts
// Correct
await expect(loadConfig()).resolves.toEqual({ ok: true })

// Wrong — silently passes if loadConfig rejects or returns the wrong value
expect(loadConfig()).resolves.toEqual({ ok: true })
```

### Narrow with `expect.unreachable()`, not silent returns

When narrowing a discriminated union in a test (the most common case:
proving `result.ok === false` so you can access `result.failure`), use
`expect.unreachable()` to fail the test if the narrowing precondition
doesn't hold. Do **not** use `if (...) return` or `if (...) throw`.

A silent `return` in a test body looks like a passing test — Bun's
runner sees no failed assertion and reports green. A failing test
that prints "pass" is worse than no test at all.

`throw new Error('unreachable')` works (it does fail the test) but is
verbose and hides intent behind a generic Error. `expect.unreachable()`
is the dedicated primitive for this exact case: it fails the test,
counts as an assertion, and reads as "I'm asserting this code path is
impossible."

**Wrong** — silent return; failing precondition reports as passing test:

```ts
test('failure carries the right shape', () => {
  const result = doThing()
  expect(result.ok).toBe(false)
  if (result.ok) return                  // ← silently swallows a real bug
  expect(result.failure.code).toBe('FOO')
})
```

**Wrong** — verbose throw; works but reads like a comment:

```ts
test('failure carries the right shape', () => {
  const result = doThing()
  if (result.ok) throw new Error('unreachable')
  expect(result.failure.code).toBe('FOO')
})
```

**Correct** — `expect.unreachable()` is purpose-built for this:

```ts
test('failure carries the right shape', () => {
  const result = doThing()
  if (result.ok) expect.unreachable()
  expect(result.failure.code).toBe('FOO')
})
```

The same applies to nested narrowing on tagged unions:

```ts
test('failure has facet kind', () => {
  const result = doThing()
  if (result.ok) expect.unreachable()
  if (result.failure.kind !== 'facet') expect.unreachable()
  expect(result.failure.check).toBe('A')
})
```

`expect.unreachable()` doesn't need a message argument in most cases —
the line number and surrounding test name already tell the reader
which precondition failed. Add a string only if the failure mode
needs explanation a glance at the line wouldn't give.

When a preceding `expect(...).toBe(...)` would assert the same
condition, drop it: the `expect.unreachable()` arm fails the test
just as loudly and avoids the redundant assertion. The narrowing
itself is the assertion.

## Turbo Caching

The `check` pipeline (`bun check`) orchestrates `test`, `types`, `lint`, and other tasks via Turborepo. Caching rules:

- **`build`** is cached by default. The CLI package (`packages/cli`) overrides this with `cache: false` in its package-level `turbo.json` because the compiled binary is too large for remote cache.
- **`test`** and **`types`** are cached and never depend on `build`. End-to-end tests that need a compiled binary live in a separate **`test:e2e`** task — see "Test conventions" below.
- Package-level overrides live in `packages/<name>/turbo.json`.

### Test conventions

- `*.test.ts` files are unit tests. They import from source (`../index.ts`, not `dist/`) and never depend on `build`.
- `*.e2e.test.ts` files are end-to-end tests. They may spawn compiled binaries or read from `dist/`. They run via `test:e2e`, which `dependsOn: ["build", "^build"]`.
- `bun check` is the canonical entry point — it runs lint, types, unit tests, e2e tests, and the root-level `scripts/` tests via Turbo.
- `bun test` at the repo root tests files in `scripts/` only (configured via root `bunfig.toml` `[test] root`). For per-package work use `bun test --cwd packages/<pkg>` (unit only) or `bun run --cwd packages/<pkg> test:e2e`.
- The `test` script in each package excludes e2e files via `bun test --path-ignore-patterns '**/*.e2e.test.ts'` (set per-package in `package.json`).

### CLI build caching

The CLI compiled binary is too large for remote cache (causes upload failures in CI). To handle this:

- **Locally**: `packages/cli/turbo.json` has caching enabled — the CLI build caches normally.
- **In CI**: The pipeline copies `packages/cli/turbo.ci.json` over `turbo.json` before running checks, which sets `cache: false` on the build task. After checks pass, it restores the original via `git checkout`.
- **Keep in sync**: When modifying `packages/cli/turbo.json`, also update `turbo.ci.json`. The only difference between them should be `"cache": false` on the build task in the CI variant.

### When adding a new package

1. Add `"test": "bun test"` and `"types": "tsc --noEmit"` scripts to its `package.json` so turbo picks them up for the `check` pipeline.
2. If the package has end-to-end tests that depend on build output, name them `*.e2e.test.ts`, add a `test:e2e` script, and create a `turbo.json` with `"test:e2e": { "dependsOn": ["build", "^build"] }`. See `packages/cli/` for an example.
3. If the package's build output is too large for remote cache, add `"build": { "cache": false }` to the package-level `turbo.json`.

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx, or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Agent Spawning Rules

When spawning subagents, **never delegate the same inputs you received** to a copy of yourself. This causes infinite recursive delegation.

- **Bad**: Agent receives "Explore X, Y, and Z" → spawns subagent with "Explore X, Y, and Z"
- **Good**: Agent receives "Explore X, Y, and Z" → spawns three subagents: "Explore X", "Explore Y", "Explore Z"

Decompose tasks into smaller, distinct sub-questions before delegating. Each subagent must receive a narrower, well-scoped slice of the original task — never the full task verbatim.

### Examples

#### Input received

An Explore agent is spawned with the following context:

> In the codebase at <projectDir>, investigate how sessions are stored, pruned, or deleted. I need very thorough findings on:
> 1. Where sessions are stored (filesystem, database, memory?) - find the storage layer
> 2. Any code that deletes, prunes, or cleans up sessions (search for delete/remove/cleanup/prune related to sessions)
> 3. Any startup/initialization code that might clean up old sessions on boot
> 4. How the `prune` config option works - does it only prune tool outputs from context window, or does it delete actual session records from storage?
> 5. Any connection between `OPENCODE_DISABLE_PRUNE` env var and session lifecycle

#### Wrong

Spawn one subagent with the full context verbatim.

#### Right

Spawn 5 Explore subagents, one per question:

- Subagent 1: "In the codebase at <projectDir>, where are sessions stored? Find the storage layer — filesystem, database, memory, etc. Return exact file paths and line numbers."
- Subagent 2: "In the codebase at <projectDir>, find any code that deletes, prunes, or cleans up sessions. Search for delete/remove/cleanup/prune related to sessions. Return exact file paths and line numbers."
- Subagent 3: "In the codebase at <projectDir>, find any startup or initialization code that cleans up old sessions on boot. Return exact file paths and line numbers."
- Subagent 4: "In the codebase at <projectDir>, how does the `prune` config option work? Does it only prune tool outputs from the context window, or does it delete actual session records from storage? Return exact file paths and line numbers."
- Subagent 5: "In the codebase at <projectDir>, is there any connection between the `OPENCODE_DISABLE_PRUNE` env var and session lifecycle? Return exact file paths and line numbers."