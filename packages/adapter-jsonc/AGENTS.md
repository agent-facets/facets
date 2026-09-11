# `@agent-facets/adapter-jsonc`

Read the module doc-comment at the top of `src/index.ts` first. It
explains what this package is for and why parsing and editing are
separate. This file covers only the obligations that live **outside**
this package and that its own source cannot express.

## Adding a runtime dependency is a three-file change

This package is private, has no build step, and is consumed as source.
Its dependencies are inlined into each consumer's published bundle by
*that consumer's* tsdown config. So adding anything to `dependencies`
here also requires adding it to `deps.alwaysBundle` in **both**:

- `packages/adapters/claude-code/tsdown.config.ts`
- `packages/adapters/opencode/tsdown.config.ts`

Neither adapter declares `jsonc-parser` itself; it resolves through
this package's `dependencies`. A dependency added here but missing from
either `alwaysBundle` list produces a `dist/index.mjs` that fails at
install time, in a user's project, with no build warning.

Neither `bun test` nor `tsgo --noEmit` catches it. The tripwire is
`assertDistBundleContract` from `@agent-facets/adapter-test-kit`, which
runs only under `test:e2e`.

Check also whether the new dependency needs a `resolve.mainFields`
override. `jsonc-parser` does: it publishes no `exports` map, so the
default field order selects its UMD build, whose lazy
`require('./impl/...')` calls cannot resolve from `dist/`. Both
consumer configs carry that workaround and explain it.

## Claude Code must not use `parseJsoncDocument`

Claude Code reads `.mcp.json` with strict `JSON.parse`. Validating with
the tolerant parser here would accept a document Claude Code itself
rejects — silently "fixing" a file the tool was already ignoring.

So Claude Code validates with `JSON.parse` and uses this package only
for the syntax-aware **edit**. OpenCode, whose format is genuinely
JSONC, uses the full surface. Do not consolidate the two parse paths.

## Codex does not use this package

Codex stores MCP servers in TOML. If a fourth adapter needs
JSON-family editing, add it to both lists above. If it needs TOML, this
is not the place.
