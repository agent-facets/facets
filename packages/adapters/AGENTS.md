# `packages/adapters/*` — first-party adapters

Three published packages — Claude Code, Codex, OpenCode — each teaching
the facet pipeline about one AI coding tool. They are registered in
`packages/engine/src/adapters/first-party.ts`, and the CLI loads each
one's `dist/index.mjs` at install time.

These rules apply to all three. **Tool-specific facts are not
documented here** — see "Where per-tool facts live" at the bottom.
There are deliberately no per-package AGENTS.md files: the packages are
~85% identical, and three copies of these rules would drift.

## The invariants that define this directory

- **Adapters plan; they never write.** Return a plan of exact `A → B`
  file transitions; engine's transaction
  (`packages/engine/src/fs/`) commits it.
- **Every failure is a returned discriminated union.** The only throws
  are inside a `try`/`catch` that immediately converts to a result.
- **`projectRoot` comes from the request.** Never `process.cwd()`.
  Every `adapter.test.ts` asserts this.
- **Scope `'system'` is refused** — `baseDirFor` returns `null`, which
  becomes `{ code: 'unsupported-scope' }`.
- **Never launch, connect to, health-check, or authenticate a server.**
  An adapter reads to plan, and returns the plan.

## Package skeleton

All three share the same eight-file layout. `tsconfig.json`,
`turbo.json`, and the `package.json` script block are copied verbatim
between siblings — start a new adapter by copying one, not by writing
from scratch.

```
package.json  tsconfig.json  turbo.json  bunfig.toml  tsdown.config.ts
src/index.ts          # defineAdapter() + AssetCapability
src/mcp-servers.ts    # McpServerCapability
src/__tests__/{adapter,mcp-servers,dist.e2e}.test.ts
```

## Manifest rules

- **Zero runtime dependencies.** Everything goes in `devDependencies`
  and in tsdown's `deps.alwaysBundle`. `dist/index.mjs` must resolve
  nothing but `node:` builtins — enforced by `assertDistBundleContract`
  from `@agent-facets/adapter-test-kit`, which runs under `test:e2e`.
- `exports` points at `src/index.ts`; `publishConfig.exports` remaps to
  `dist/`. `files` is `["dist"]`.
- **Never hand-write `facetAdapterApiVersion`.** `scripts/prepack.ts`
  stamps it from `packages/adapter/src/api-version.ts` for everything
  under this directory.
- **Versions are independent across adapters.** Do not align them.

## `src/index.ts`

- `baseDirFor(context)` returns `string | null`, with `'system'`
  returning `null`.
- `fileTarget()` / `skillTarget()` return the target path plus a
  `boundary`. The boundary is always the tool's base directory, and an
  install neither creates nor removes it.
- `planInstall` / `planRemoval` switch exhaustively over
  `skill | agent | command` with **no `default` arm**, so a new asset
  type breaks the build.
- Skills always go through `planSkillBundleInstall` /
  `planSkillBundleRemoval` from the SDK.
- `buildAssetMetadata` maps arktype errors into the SDK's
  `ValidationError` shape. That block is identical in all three — copy
  it; do not invent a second error shape.

## `src/mcp-servers.ts`

- Export a named `<tool>McpServers: McpServerCapability` with a single
  `async plan(request)`, and wire it into `defineAdapter`.
- Read through `readTextOrAbsent`, then hand off to
  `prepareMcpTextPlan`.
- **Fail closed.** `compareEntry` returns `'divergent'` for any key
  that is neither portable nor explicitly safe. An unrecognized key
  defeats equality; it never gets ignored.
- **Safe extensions are behavior-neutral only** — never
  authentication-shaped — and are carried forward *only* when the
  outcome is divergent and the name is already tracked. An untracked
  takeover inherits nothing. `enabled: false` is never safe.
- Compare parsed documents, not bytes, but carry the exact prior bytes
  as the mutation's expected state.
- Edit syntax-aware; never reserialize a document a user hand-edits.
- If the tool interpolates config values, pass an `interpolation`
  guard. **If it does not, say so in the module doc-comment** — a
  missing guard should be a recorded decision, not an omission.

## Testing

- Three files, fixed names. Only `*.e2e.test.ts` may touch `dist/`.
- `packages/adapter-test-kit` owns the MCP matrix and its invariants.
  Read `packages/adapter-test-kit/AGENTS.md` before adding a case or a
  seed.
- `adapter.test.ts` has a fixed spine: adapter identity, project
  layout (project scope, command, skill bundle, user scope under
  `$HOME`, system refused), planning (metadata encoding, re-plan
  unchanged, occupied path is divergent with exact prior bytes,
  planning writes nothing), and removal (owned companions only, absent
  is `kind: 'absent'`).
- Restore every mutated environment variable in `afterEach`. OpenCode
  also reads `XDG_CONFIG_HOME`.
- Narrow with `expect.unreachable()`, never `if (ok) return`.
- Commands: `bun test --cwd packages/adapters/<name>`,
  `bun run --cwd packages/adapters/<name> test:e2e`.

## Adding a new adapter

1. Copy a sibling's skeleton.
2. Register it in `packages/engine/src/adapters/first-party.ts`.
3. Seed the **full** MCP matrix — the type system will list what is
   missing.
4. Give `bunfig.toml` its own JUnit output filename.
5. Include the new package in the changeset.
6. Run `bun run seed:adapters` before the first publish.

## Release ordering

An adapter API version change is a coordinated release: the SDK and all
adapters go out before the CLI that requires the new version, and
publishes from this directory are frozen between cycles because prepack
stamps the constant. The full procedure lives in
`scripts/release/README.md` — follow it there rather than reconstructing
it from memory.

## Where per-tool facts live

| Fact | Owner |
|---|---|
| MCP document locations, layering, target selection | `openspec/specs/adapter__mcp-servers/spec.md` |
| Asset directory layout for a tool | the `baseDirFor` doc-comment in that adapter's `src/index.ts`, asserted by its `adapter.test.ts` |
| Why a format or parser choice was made | the module doc-comment in that file |

Do not restate any of those here.
