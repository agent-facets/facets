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
│  1. verify.ts — wait until 12 platform packages are available │
│  2. publish-cli-package.ts — synthesize + publish             │
│     agent-facets wrapper with optionalDependencies →          │
│     all 12 platform packages                                  │
│  3. verify.ts — wait until the wrapper is available           │
│  4. Create GitHub Release + Slack notification                │
└───────────────────────────────────────────────────────────────┘
```

## Scripts

| Script                    | CircleCI Job                | Purpose                                                     |
|---------------------------|-----------------------------|-------------------------------------------------------------|
| `build.test.ts`           | (local tests)               | Verify actual build options, native preflight and isolated policy |
| `build.ts`                | `build-cli`                 | Cross-compile 12 standalone binaries                        |
| `package-assets.ts`       | `package-cli-assets`        | Package existing binaries into archives and checksums       |
| `upload-assets.ts`        | `upload-cli-assets`         | Upload packaged archives to the GitHub Release              |
| `publish-platform.ts`     | `publish-platform` (matrix) | Publish one `@agent-facets/cli-*` package                   |
| `publish-cli-package.ts`  | (called by finalize)        | Synthesize and publish the `agent-facets` wrapper           |
| `finalize.ts`             | `finalize-cli`              | Orchestrate: wait for platforms → publish wrapper → wait for wrapper → announce |
| `verify.ts`               | (called by finalize)        | Wait until a given list of packages is available on npm     |
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
build-cli ─┬─ publish-platform (×12) ── finalize-cli (npm wrapper + release) ─┐
           └─ package-cli-assets (archives + checksums) ──────────────────────┴─ upload-cli-assets
```

Neither npm publishing nor finalization requires the packaging job. Packaging
failures are reported by CircleCI and Slack but do not block npm deployment.
`upload-cli-assets` waits for both branches of the workflow, then uploads the
packaged archives to the GitHub Release with `gh release upload --clobber`.

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
4. Waiting for availability twice: before publishing the wrapper, for the 12 platforms
   (so the wrapper's `optionalDependencies` resolve when users install), and after,
   for the wrapper itself before announcing (see below)

None of this fits `changeset publish`'s model, so the CLI has its own pipeline.

## Upload accepted vs. available

A successful `npm publish` means npm **accepted** the upload — it prints "Your package
is being processed and may take a few minutes to become available." npm then scans the
version before serving it: typically about five minutes, sometimes fifteen or more, and
it may hold or block a version outright. In the 0.36.0 release, the last platform package
became available about 7m25s after its publish job succeeded.

`verify.ts` therefore waits for **availability**, not acceptance. Through
`scripts/lib/npm-readiness.ts`, it fetches each package's full packument from
`https://registry.npmjs.org` — one request, with no npm disk cache and no hidden npm
retries — and requires the exact version in it. That does not bypass registry/CDN
caching, and public metadata cannot tell a version still being scanned from one that
is held or blocked. Each result is logged with its HTTP status, duration, and cache
headers, and "not available yet" is reported separately from rate limiting, timeouts,
network failures, unexpected statuses, and malformed metadata.

Only a 200 body is read. Any other response is classified from its status and headers
alone, and its body is cancelled and its request aborted, so an error page cannot keep
downloading past the request budget or pile up across polls. When headers arrive but
the body then fails or times out, the log still shows the status and cache headers
that were received rather than "no response".

Each stage polls under one contract:

- A **20-minute** wall-clock deadline covering requests and waits.
- Rounds start immediately, then **30 seconds** after the previous round ends. Each
  round checks every pending package once, sequentially; a missing or failed package
  never skips the rest, and available packages are not checked again.
- Each request is cut off at **10 seconds** or the remaining budget, whichever is shorter.
- An HTTP 429 pauses all requests for 30 seconds or `Retry-After`, whichever is longer,
  then the round resumes with the next package.
- No request starts after the deadline. On failure, every unavailable package is listed
  with its last result, or as not checked before the deadline.
- Long waits log a heartbeat every minute so CI's no-output timeout never fires.

The two stages can wait up to 40 minutes combined. If a wait times out, `finalize.ts`
exits nonzero before anything further is published or announced: a platform timeout
means the wrapper is never published; a wrapper timeout means the release is never
announced. **Do not republish** — npm already accepted the version, even if it is not
serving it yet. Check the package's npm page and any npm notification for a hold or
block, then rerun `finalize-cli` once the versions are available; the wrapper publish
skips a version that already exists.

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
