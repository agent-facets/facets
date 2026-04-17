# CLI Binary Release Pipeline

Cross-compiles and publishes the `agent-facets` CLI as standalone binaries for 12 platform/arch/ABI targets.

## Flow

```
Tag push: agent-facets@X.Y.Z
  │
  ▼
┌───────────────────────────────────────────────────────────────┐
│  build.ts                                                     │
│                                                               │
│  Cross-compile 12 platform binaries via Bun.build({compile})  │
│  Persist dist/ to workspace                                   │
└──────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────────────┐
│  publish-platform.ts (×12 matrix jobs)                        │
│                                                               │
│  Each job publishes one @agent-facets/cli-* platform package  │
│  to npm with --tag latest                                     │
└──────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────────────┐
│  finalize.ts                                                  │
│                                                               │
│  1. publish-cli-package.ts — synthesize agent-facets wrapper  │
│     with optionalDependencies → all 12 platform packages      │
│  2. verify.ts — check all 13 packages exist on npm            │
│  3. Create GitHub Release + Slack notification                │
└───────────────────────────────────────────────────────────────┘
```

## Scripts

| Script                    | CircleCI Job                | Purpose                                                     |
|---------------------------|-----------------------------|-------------------------------------------------------------|
| `build.ts`                | `build-cli`                 | Cross-compile 12 standalone binaries                        |
| `publish-platform.ts`     | `publish-platform` (matrix) | Publish one `@agent-facets/cli-*` package                   |
| `publish-cli-package.ts`  | (called by finalize)        | Synthesize and publish the `agent-facets` wrapper           |
| `finalize.ts`             | `finalize-cli`              | Orchestrate: publish wrapper → verify → announce            |
| `verify.ts`               | (called by finalize)        | Verify all 13 packages exist on npm (with retry)            |
| `seed.ts`                 | (manual, `bun seed:cli`)    | Seed platform package names on npm with v0.0.1 placeholders |
| `targets.ts`              | (imported)                  | Platform target matrix and pure helper functions            |

OIDC trusted-publishing instructions are printed from the shared helper at `scripts/lib/seed-oidc.ts`, which is reused by the library/adapter seed script (`scripts/release/seed-adapters.ts`).

## Platform Targets (12)

```
darwin-arm64, darwin-x64, darwin-x64-baseline
linux-arm64, linux-arm64-musl, linux-x64
linux-x64-baseline, linux-x64-baseline-musl, linux-x64-musl
windows-arm64, windows-x64, windows-x64-baseline
```

## Why the CLI needs a custom pipeline

Users install via `npm install agent-facets`. npm resolves the correct platform binary through `optionalDependencies` — it installs only the matching `@agent-facets/cli-*` package for the user's OS/arch. This requires:

1. Cross-compiling 12 binaries (can't use `npm publish` on source)
2. Publishing 12 platform packages first (each in its own CI job to avoid OOM)
3. Publishing the wrapper package last (it references all 12 via optionalDependencies)
4. Verifying all 13 packages before announcing (npm registry propagation delay)

None of this fits `changeset publish`'s model, so the CLI has its own pipeline.
