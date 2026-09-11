# Agent Facets

A Turborepo monorepo, built and tested with Bun, that ships the `facet`
CLI and the packages it is assembled from.

This file is the **map**. It carries only what applies to the whole
repository. Anything that is true of exactly one package lives in that
package's own `AGENTS.md` — follow the link before working in a
package.

## Running Bun commands

Sometimes `bun` is not available in the shell. If that happens prefix the `bun`
commands with `mise exec --` like the following: `mise exec -- bun format`.

Mise will ensure you find the `bun` executable correctly.

## Architecture

Three layers, plus the SDK that third parties implement against:

- **protocol** (Layer 1) — the facet artifact specification. Schemas,
  integrity, content hashing, archive format, materialization planning.
  Runs on Node; published to npm.
- **engine** (Layer 2) — one concrete implementation of that spec on a
  developer's machine. Install/update/remove pipelines, registry client,
  cache, filesystem transaction. Bun-native; never published.
- **cli** (Layer 3) — argument parsing, Ink views, error formatting,
  exit codes. Replaceable skin over the two layers below it.
- **adapter** — the SDK an adapter implements to teach the pipeline about
  an AI coding tool. Published; must stay a leaf.

The test for where code goes: **if `engine` were rewritten in Rust
tomorrow, would this line change?** No means protocol. Yes means engine.
If it is intrinsically about a terminal, it is cli.

## Workspaces

`packages/*` and `packages/adapters/*` (root `package.json`). Eleven
packages; seven publish to npm.

| Package | npm | Purpose | Rules |
|---|---|---|---|
| `packages/protocol` | public | Reference implementation of the facet spec | [AGENTS.md](packages/protocol/AGENTS.md) |
| `packages/engine` | no | CLI machinery: install, registry, cache, fs transaction | [AGENTS.md](packages/engine/AGENTS.md) |
| `packages/cli` | public (`agent-facets`) | The `facet` binary; Ink TUI | [AGENTS.md](packages/cli/AGENTS.md) |
| `packages/adapter` | public | Adapter SDK (`defineAdapter`) | [AGENTS.md](packages/adapter/AGENTS.md) |
| `packages/common` | no | Primitives shared across published packages | [AGENTS.md](packages/common/AGENTS.md) |
| `packages/brand` | public | Color, theme, and font tokens | [AGENTS.md](packages/brand/AGENTS.md) |
| `packages/adapter-jsonc` | no | JSONC parse/edit helpers for adapters | [AGENTS.md](packages/adapter-jsonc/AGENTS.md) |
| `packages/adapter-test-kit` | no | Shared adapter conformance fixtures | [AGENTS.md](packages/adapter-test-kit/AGENTS.md) |
| `packages/adapters/claude-code` | public | First-party adapter | [AGENTS.md](packages/adapters/AGENTS.md) |
| `packages/adapters/codex` | public | First-party adapter | [AGENTS.md](packages/adapters/AGENTS.md) |
| `packages/adapters/opencode` | public | First-party adapter | [AGENTS.md](packages/adapters/AGENTS.md) |

Do not maintain a directory listing here. Each package's `src/index.ts`
and its own `AGENTS.md` are the source of truth for what it contains.

### Other directories

| Directory | Purpose | Rules |
|---|---|---|
| `docs/` | Mintlify documentation site | [AGENTS.md](docs/AGENTS.md) |
| `scripts/` | Release and repo tooling | [AGENTS.md](scripts/AGENTS.md) |
| `.circleci/` | Packed CircleCI configs | [AGENTS.md](.circleci/AGENTS.md) |
| `openspec/` | Change management (specs, changes, schemas) | — |

## Runtime

There is no single runtime rule. It is per package:

- **`protocol`** must run on **Node 22+ with no Bun on `$PATH`**. No
  `Bun.*` globals, no subprocesses, no network, no filesystem writes.
- **`engine`, `cli`, `scripts/`** are Bun-native. Use the `Bun.*`
  globals (`Bun.file`, `Bun.spawn`, `Bun.Glob`, `Bun.gzipSync`), never
  `import ... from 'bun'`.
- **`adapter`, `brand`, `common`** are published or bundled into
  published artifacts and stay runtime-agnostic.

`node:*` imports are not a smell. Engine's filesystem transaction is
built on `node:fs` deliberately (`packages/engine/src/fs/syscalls.ts`),
because it needs syscall-level control that `Bun.file` does not expose.

Beyond that, Bun is the toolchain: `bun install`, `bun run <script>`,
`bun test`, `bun <file>`. Libraries build with `tsdown`; the CLI binary
builds with `bun build --compile`.

OpenSpec commands MUST run as `bun openspec ...`, never `npx openspec ...`.

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

- `packages/protocol/src/integrity/types.ts` — `IntegrityResult`,
  `IntegrityFailure`. Pure-data failure shape; no thrown errors.
- `packages/engine/src/install/lockfile-io.ts` — `LoadLockfileResult` as
  `{ ok: true; data; existed } | { ok: false; error }`.
- `packages/engine/src/install/types.ts` — `RunInstallResult`, the
  largest union in the repo. Failures are typed by a `code`
  discriminator with structured fields per code.
- `@agent-facets/common`'s `Validated<T>` — the project-wide alias for
  "validated payload or list of errors."

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
  throw is internal; it never escapes the function.

### Anti-patterns to refuse

- **A typed error class.** `class FooError extends Error` is still
  invisible to the type system. Use a union member.
- **"The caller can wrap it in try/catch."** That is a runtime check the
  compiler cannot verify.
- **"It's only for exceptional cases."** "Exceptional" is in the eye of
  the caller. If it is part of the contract, it goes in the return type.
- **A mixed contract.** If any failure mode in a function returns a
  result, all of them should.

When you spot a throw a caller might reasonably want to handle, convert
it. The diff is mechanical; the type-system improvement is permanent.

## Testing

`bun check` is the canonical entry point. It runs lint, type checks,
unit tests, e2e tests, the `scripts/` tests, docs validation, and the
CircleCI config pack check via Turbo.

Per-package: `bun test --cwd packages/<pkg>` for unit tests,
`bun run --cwd packages/<pkg> test:e2e` for e2e.

### Test conventions

- `*.test.ts` files are unit tests. They import from source
  (`../index.ts`, never `dist/`) and never depend on `build`.
- `*.e2e.test.ts` files may spawn compiled binaries or read `dist/`.
  They run via `test:e2e`, which `dependsOn: ["^build"]`. Packages that
  have them exclude them from `test` with
  `--path-ignore-patterns '**/*.e2e.test.ts'`.
- `bun test` at the repo root tests `scripts/` only (root `bunfig.toml`
  sets `[test] root`).

### Awaiting async expectations

Bun's `expect(...).rejects.<matcher>` and `expect(...).resolves.<matcher>` return
promises. You **MUST** `await` the entire expression (or `return` it from the
test). Without the outer `await`, Bun's test runner sees a synchronous return,
the assertion promise never settles in scope, and a failing assertion silently
passes — the test appears green but provides no guarantee.

```ts
// Correct — the outer await makes the assertion actually run
await expect(async () => {
  await fetchUser('invalid-id')
}).rejects.toThrow('User not found')

// Wrong — passes even when fetchUser does not throw
expect(async () => {
  await fetchUser('invalid-id')
}).rejects.toThrow('User not found')

// Correct
await expect(loadConfig()).resolves.toEqual({ ok: true })

// Wrong — silently passes if loadConfig rejects or returns the wrong value
expect(loadConfig()).resolves.toEqual({ ok: true })
```

### Narrow with `expect.unreachable()`

When narrowing a discriminated union in a test — most often proving
`result.ok === false` so you can reach `result.failure` — use
`expect.unreachable()`. Never `if (...) return`: a silent return looks
like a passing test, and a failing test that prints "pass" is worse than
no test at all. `throw new Error('unreachable')` works but hides intent.

```ts
test('failure carries the right shape', () => {
  const result = doThing()
  if (result.ok) expect.unreachable()
  if (result.failure.kind !== 'facet') expect.unreachable()
  expect(result.failure.check).toBe('A')
})
```

Drop any preceding `expect(result.ok).toBe(false)` — the narrowing is
the assertion.

## Formatting

When `bun check` (or `bun run lint`) reports a Biome **formatting** error, run
`bun format` to fix it. Do NOT hand-edit whitespace, line wrapping, or trailing
commas to satisfy the formatter — `bun format` runs
`biome check --write --unsafe .` across the whole repo in a few hundred
milliseconds. Edit by hand only for lint *rule* violations it cannot auto-fix.

## Turbo caching

- **`build`** is cached. `packages/cli/turbo.json` overrides `outputs` to
  `[]`: the compiled binary is ~64 MB, too large for the Lambda-based
  remote cache, so Turbo caches the hash without uploading the artifact.
  The CLI's `test:e2e` inlines `bun run build &&` so the binary is
  produced fresh without poisoning the cache chain.
- **`test`** and **`types`** are cached and never depend on `build`.
- Package-level overrides live in `packages/<name>/turbo.json`.

### When adding a new package

1. Add `"test": "bun test"` and `"types": "tsgo --noEmit"` scripts so
   Turbo picks it up for the `check` pipeline. Every package uses
   `tsgo` (`@typescript/native-preview`), not `tsc`.
2. If it has tests that depend on build output, name them
   `*.e2e.test.ts`, add a `test:e2e` script that inlines the build, and
   exclude them from `test`.
3. If its build output is too large for the remote cache, set
   `"outputs": []` in the package-level `turbo.json`.
4. Add it to the workspace table above, and give it an `AGENTS.md` only
   if it has rules that its own source cannot express.
