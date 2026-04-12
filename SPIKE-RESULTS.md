# Spike Results: Bun Dynamic Import for Platform Adapters

**Date**: 2026-04-11 (updated 2026-04-12)
**Branch**: `julian/bun-dynamic-import-spike`
**Status**: PROVEN WITH CAVEAT — dynamic import works, but adapters must be pre-bundled

## Goal

Prove that a compiled Bun binary (produced by `bun build --compile`) can dynamically `import()` a platform adapter file from the filesystem at runtime — without the adapter being bundled at compile time.

## Results

### Dev mode (bun run, no compilation)

| Test | Result |
|---|---|
| Dynamic import of `.ts` with type-only imports | PASS |
| Dynamic import of `.ts` with runtime imports from `@agent-facets/adapter` | PASS |

Everything works in dev mode. Bun resolves workspace packages via `node_modules` linking.

### Compiled binary

| Test | Result | Notes |
|---|---|---|
| `.ts` with `import type` only (erased at compile) | PASS | Types are erased — no runtime resolution needed |
| `.ts` with **runtime** import from `@agent-facets/adapter` | **FAIL** | `Cannot find module '@agent-facets/adapter'` |
| `.ts` with no external package imports (standalone, `node:*` only) | PASS | Built-in Node modules resolve fine |
| **Pre-bundled `.js`** (single file, deps inlined by `bun build`) | **PASS** | All dependencies resolved at bundle time |

### Critical finding

The initial test (type-only imports) was a false positive. TypeScript type imports are erased at transpile time, so the adapter file had zero runtime dependency on `@agent-facets/adapter`. When we added a real runtime import (`ADAPTER_API_VERSION` constant with value `spike-2026-04-12-runtime-proof`, `emptyValidationResult()` function), the compiled binary could not resolve the package.

### Bundling `@agent-facets/adapter` into the CLI binary does NOT help

We tested whether adding `@agent-facets/adapter` as a real dependency of the CLI (so it gets bundled into the compiled binary) would make it available to dynamically imported adapter files. Results:

| Test | Result |
|---|---|
| CLI binary's own import of `@agent-facets/adapter` | PASS — `ADAPTER_API_VERSION=spike-2026-04-12-runtime-proof` |
| External adapter imports `@agent-facets/adapter` via bare specifier | **FAIL** — `Cannot find module` |
| External adapter uses relative path to source on disk | PASS — but only because the source file exists on disk, not portable |

The binary's bundled modules live in an internal module graph that is NOT accessible to dynamically imported code. Dynamic imports resolve only against the real filesystem. Even though the CLI has `@agent-facets/adapter` bundled and uses it successfully in its own code, an adapter file loaded via `import()` at runtime cannot see it.

**The fix**: pre-bundle the adapter into a single `.js` file before distribution. `bun build adapter.ts --outfile adapter.js` inlines all dependencies. The compiled CLI binary loads the bundled `.js` file without issues.

## Key Findings

1. **Dynamic `import()` works in compiled Bun binaries.** The compiled binary contains the full Bun runtime (TypeScript transpiler, module loader). It can load `.ts` and `.js` files from any filesystem path at runtime.

2. **Module resolution for bare specifiers does NOT work — even when bundled into the binary.** When a dynamically imported file tries to `import ... from '@agent-facets/adapter'`, the compiled binary cannot resolve it. The binary's internal module graph (containing all statically bundled dependencies) is NOT exposed to dynamically imported code. Even adding `@agent-facets/adapter` as a CLI dependency so it's compiled into the binary does not help — the dynamic import resolver only searches the real filesystem, not the binary's bundled modules.

3. **Pre-bundled adapters work perfectly.** Running `bun build` on the adapter to produce a single `.js` file (with dependencies inlined) solves the resolution problem completely. The bundled file has no external imports to resolve.

4. **Node built-ins work.** Imports like `node:fs` and `node:path` resolve correctly in dynamically imported files — these are provided by the Bun runtime embedded in the binary.

5. **No external runtime dependency is needed.** The compiled binary IS the runtime. Users don't need `bun`, `node`, or any JS runtime installed.

## Architecture Implications

The adapter distribution model:

```
Adapter Author:
  1. Write TypeScript adapter (imports @agent-facets/adapter for types + helpers)
  2. bun build src/index.ts --outfile dist/adapter.js  (single bundled file)
  3. Publish the bundled .js file (npm, registry, etc.)

Consumer:
  facet adapter install <name>
    → downloads dist/adapter.js to ~/.facets/adapters/<name>/
    → CLI dynamically import()s it at runtime
```

### What this means for first-party adapters

First-party adapters (OpenCode, Claude Code) can be:
- **Statically imported** into the CLI (bundled at compile time) — zero overhead, always available
- **OR distributed as bundled `.js` files** — same mechanism as third-party

For Phase 3, statically importing first-party adapters is simpler. The dynamic loading infrastructure is ready when third-party adapters arrive.

### What adapter authors need to do

1. Write a TypeScript file that default-exports a `PlatformAdapter`
2. Depend on `@agent-facets/adapter` for the interface types and any runtime helpers
3. Run `bun build` to produce a single bundled `.js` file
4. Publish the bundled file

The build step is the one extra piece compared to "just write a .ts file." This could be automated via a `prepublish` script or a CLI scaffolding tool (`facet create-adapter`).

## Performance Notes

Dynamic import adds negligible overhead. The adapter bundle is tiny (< 1KB for the OpenCode adapter). Bun evaluates it effectively instantly. No measurable difference between static and dynamic adapter loading.

## Files Created (Throwaway Spike Code)

- `packages/adapter/` — minimal adapter contract package (with runtime exports)
- `packages/adapters/opencode/` — stub OpenCode adapter (with runtime imports)
- `packages/cli/src/commands/spike-adapter.ts` — spike command
- `tmp/standalone-adapter.ts` — self-contained adapter (no package imports)
- `tmp/bundled-adapter.js` — pre-bundled adapter (single file)
- `spike-test.sh` — original test script (tests before runtime import fix)
- `SPIKE-RESULTS.md` — this file

## Recommendation

**Dynamic import of pre-bundled adapters is the right path.** The mechanism is proven and the developer experience is good:

- No cross-compilation per platform
- No external runtime dependency
- No stdio/JSON-RPC protocol complexity
- Adapters are TypeScript with one `bun build` step before publish
- The `@agent-facets/adapter` contract package provides types + runtime helpers at dev time
- The bundled output is a single portable `.js` file

The one nuance: adapters can't be raw `.ts` files with bare package imports. They must be pre-bundled. This is a reasonable constraint — it's the same model npm packages use (source in `src/`, bundled output in `dist/`).
