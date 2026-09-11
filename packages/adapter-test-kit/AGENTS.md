# `@agent-facets/adapter-test-kit`

Shared conformance fixtures so the first-party adapters prove the
**same** behavior instead of three hand-written approximations of it.
Private, unbuilt, test-only: nothing here reaches a published bundle,
and no adapter's `src/index.ts` may import it.

## `packages/adapter` imports this by relative path on purpose

`packages/adapter/src/__tests__/dist.e2e.test.ts` reaches this package
as `'../../../adapter-test-kit/src/index.ts'` rather than by name.

Do not "fix" that by adding a devDependency. This package already
devDepends on `@agent-facets/adapter`, so the reverse edge would be a
workspace cycle. The adapters under `packages/adapters/*` have no such
problem and import by package name.

## Half of this package only works inside a test file

`dist-contract.ts` and `run-mcp-matrix.ts` import `bun:test` at module
scope and register `describe`/`test` as a side effect of being called.
`index.ts` re-exports them unconditionally, so importing the barrel
from anything that is not a test file fails at runtime.

`mcp-matrix.ts`, `module-specifiers.ts`, and `apply-plan.ts` are pure
and safe to import anywhere.

## Adding a matrix case is supposed to break every adapter

Each adapter's seed table is written `satisfies Record<McpMatrixCaseId,
McpMatrixSeed>`. A new entry in `MCP_MATRIX_CASES` therefore fails to
type-check in all three adapters until each supplies its own native
document for that case.

That is the mechanism, not an obstacle. Do not widen the seed type,
make the record partial, or give a case a default seed — each of those
lets adapter coverage drift apart silently, which is the exact failure
this package exists to prevent.

Cases are stated in portable terms only: desired declarations, prior
ownership, expected outcomes. What a document *looks like* is the one
thing a JSON, a JSONC, and a TOML adapter cannot share, so it stays in
each adapter's seeds.

`runMcpServerMatrix` already asserts the cross-cutting invariants for
every case — planning writes nothing, planned paths are absolute and
inside the project, the mutation's expected state matches disk, no
`fetch` or `Bun.spawn`, nothing written under `$HOME`, full document
disclosure. Never restate one of those in a seed's own assertions; use
those only for native-format facts (a comment survived, float notation
held, an extension carried forward).

## Two scanners, and neither may become a regex

`module-specifiers.ts` uses `ts.preProcessFile` for `.d.mts` and
`Bun.Transpiler.scanImports` for `.mjs`, because the two artifacts are
different languages. A `from "..."` regex is blind to
`import("pkg").Type` nodes — precisely the leak the SDK's declaration
tripwire exists to catch, so a regex-based version was green for the
one thing it was written to detect.

`src/__tests__/module-specifiers.test.ts` guards the guard. Its
"non-literal specifier is invisible" case documents a limitation rather
than a desired property: if a future Bun release starts reporting one,
that test should fail and the scanner's documentation should be
corrected, not the test loosened.

## `apply-plan.ts` is deliberately not the engine's transaction

Preflight, journaling, batch atomicity, and rollback are tested where
the transaction lives (`packages/engine/src/fs/`). Reimplementing them
here would test the copy, and would force adapter packages to depend on
engine to be tested at all. An adapter test needs only "and then the
plan was applied."

## The harness is Bun-only and mutates the environment

`runMcpServerMatrix` patches `globalThis.fetch`, `Bun.spawn`, and
`Bun.spawnSync` to fail loudly, and overrides `HOME`/`USERPROFILE` to a
temp directory so a user-wide document an adapter wrongly created is
visible to an assertion. All are restored in `afterEach`. It cannot run
concurrently with anything else that reads those.
