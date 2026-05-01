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

Turborepo monorepo with Bun workspaces. Five packages under `packages/`.

### `packages/core` — `@agent-facets/core`

Facet manifest parsing, validation, and build pipeline. Entry point: `src/index.ts`

```
src/
├── schemas/        # Arktype schemas (facet manifest, lockfile, server manifest)
├── loaders/        # Load and validate facet manifest / server manifests from disk
├── build/          # Build pipeline: collision detection, validation, output writing
├── types.ts        # Shared type definitions
├── index.ts        # Public API entry point
└── __tests__/      # Unit tests
```

### `packages/cli` — `agent-facets`

CLI binary (`facet`). Entry point: `src/cli.ts`

```
src/
├── commands/       # Command implementations (build, create)
├── cli/            # CLI framework: arg parsing, help, version, suggestions
├── cli.ts          # CLI entry point
└── __tests__/      # Unit tests
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