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
│  1. verify.ts — confirm 12 platform packages on npm           │
│  2. publish-cli-package.ts — synthesize + publish             │
│     agent-facets wrapper with optionalDependencies →          │
│     all 12 platform packages                                  │
│  3. verify.ts — confirm wrapper on npm                        │
│  4. Create GitHub Release + Slack notification                │
└───────────────────────────────────────────────────────────────┘
```

## Scripts

| Script                    | CircleCI Job                | Purpose                                                     |
|---------------------------|-----------------------------|-------------------------------------------------------------|
| `build.test.ts`           | (local tests)               | Verify actual build options, native preflight and isolated policy |
| `build.ts`                | `build-cli`                 | Cross-compile 12 standalone binaries                        |
| `package-assets.ts`       | `package-cli-assets`        | Package existing binaries into archives and checksums       |
| `publish-platform.ts`     | `publish-platform` (matrix) | Publish one `@agent-facets/cli-*` package                   |
| `publish-cli-package.ts`  | (called by finalize)        | Synthesize and publish the `agent-facets` wrapper           |
| `finalize.ts`             | `finalize-cli`              | Orchestrate: verify platforms → publish wrapper → verify wrapper → announce |
| `verify.ts`               | (called by finalize)        | Verify a given list of packages exists on npm (with retry)  |
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

## Release assets

After `build-cli`, `package-cli-assets` runs alongside npm publishing:

```text
build-cli ─┬─ publish-platform (×12) ── finalize-cli (npm wrapper + release)
           └─ package-cli-assets (archives + checksums)
```

Neither npm publishing nor finalization requires the packaging job. Packaging
failures are reported by CircleCI and Slack but do not block npm deployment.
Future GitHub asset uploads must stay outside the npm dependency chain too.

`package-assets.ts` writes `packages/cli/dist/release-assets` and the packaging
job persists that directory only after success. Packaging requires `tar` and `zip` on
the build host. Each archive contains a single root-level executable (`facet`
on macOS/Linux, `facet.exe` on Windows):

```text
facet-darwin-arm64.tar.gz
facet-darwin-x64.tar.gz
facet-linux-arm64.tar.gz
facet-linux-arm64-musl.tar.gz
facet-linux-x64.tar.gz
facet-linux-x64-musl.tar.gz
facet-windows-arm64.zip
facet-windows-x64.zip
checksums.txt
```

All x64 archives use baseline binaries, so installation does not require AVX2
detection. The npm package layout and its optimized variants are preserved.
`checksums.txt` contains SHA-256 hashes of the archives in standard checksum
format. Each invocation clears the release-assets directory before building
and emits checksums only for that invocation's archives.

The packaging script's `--single` and `--target` flags package only the selected
platform/ABI using already-built binaries. `--target` requires an explicit
non-flag value, so malformed invocations fail instead of falling back to a wider
target set. x64 selection always uses the baseline counterpart; build it first
with `build.ts --single --baseline` or an explicit baseline `--target`. On ARM64,
use `build.ts --single` followed by `package-assets.ts --single`. Packaging never
compiles additional binaries. The build script retains its original target
selection and npm-only behavior.

## Why the CLI needs a custom pipeline

Users install via `npm install agent-facets`. npm resolves the correct platform binary through `optionalDependencies` — it installs only the matching `@agent-facets/cli-*` package for the user's OS/arch. This requires:

1. Cross-compiling 12 binaries (can't use `npm publish` on source)
2. Publishing 12 platform packages first (each in its own CI job to avoid OOM)
3. Publishing the wrapper package last (it references all 12 via optionalDependencies)
4. Split verification to handle npm registry propagation delay: pre-publish verifies
   the 12 platforms (so the wrapper's `optionalDependencies` will resolve when users
   install), and post-publish verifies the wrapper itself before announcing.
   Each stage makes an initial check plus 8 retries with exponential backoff
   (1, 2, 4, … 128s — 4m15s of waiting, plus npm request time). Only packages
   still missing are re-queried; the stage fails if any remain after the last check

None of this fits `changeset publish`'s model, so the CLI has its own pipeline.

## Native permission dependency

The release build still runs on Linux. After the ordinary host dependency setup,
`build-cli` runs `bun install --frozen-lockfile --os '*' --cpu '*' --ignore-scripts`
to install locked foreign native prebuilds without lifecycle scripts or a compiler.
Koffi is pinned to 3.3.2; its CommonJS entry lets Bun embed the Darwin Node-API addon.
Each build defines the destination OS and CPU, selects the matching Darwin arm64
or x64 addon, and externalizes the other finite optional packages. Baseline and
optimized x64 use the same addon. Missing or mismatched Darwin native files fail
preflight before compilation. Linux and Windows emit no native addons and never enter the guarded native load;
unreachable loader JavaScript may remain in the compiled graph.

`build.test.ts` checks the actual receiving options and preflight failures, native
graph selection, and the production ACL helper in isolated arm64/x64-baseline
executables with forced GC. Option and preflight tests use stub koffi fixtures, so
they pass after a plain `bun install`. The real-native-graph test needs the Darwin
prebuilds from the cross-platform install above: it is skipped locally when they
are absent and required whenever `CI` is set (`turbo.json` declares `CI` for
`//#test:scripts`). This is compatibility evidence for pinned Bun 1.3.14
and Koffi 3.3.2, not an upstream promise of Bun support. Ordinary local CLI builds
use the host addon; released binaries and archives need no node_modules directory.

To verify without publishing, run `bun scripts/release-cli/build.ts` (all twelve),
then `bun scripts/release-cli/package-assets.ts` (eight archives/checksums). These
commands read the current version and write dist artifacts only; they do not tag,
change versions or publish. Matching-host --version smoke does not execute foreign
Linux/Windows binaries. After CI job edits, run `bun run ci:pack` and
`bun run ci:check-pack`; only the generated release config should change.
