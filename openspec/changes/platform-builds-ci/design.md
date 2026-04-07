## Context

The release pipeline has two CircleCI configs: `config.yml` (main branch — check, changesets, tag-release) and `release.yml` (tag-triggered — release job). When a version PR merges, `ci-tag-release.ts` creates git tags, which trigger the `release.yml` workflow. The release job runs `ci-release.ts`, which publishes non-private packages to npm. Private packages (the CLI) are skipped with a `TODO(binary-matrix)` at `ci-release.ts:61-76`.

Phase 1 and 2 built the tooling: `build-cli.ts` (cross-compiles 12 targets), `publish-cli.ts` (publishes to staging), and the npm helpers (`versionExists`, `distTagAdd`, `latestVersion`). The missing pieces are the CI orchestration and the verify/promote scripts.

## Goals / Non-Goals

**Goals:**

- Automate CLI binary releases end-to-end on tag push
- Build all 12 platform binaries in CI
- Publish to staging, verify registry propagation, promote to latest
- Create GitHub Release and notify Slack for CLI releases

**Non-Goals:**

- Other distribution channels (Homebrew, Docker)
- Changes to the changeset or tag-release workflows
- ARM CI runners (Bun cross-compiles from a single x64 Linux host)

## Decisions

### 1. Release pipeline stages: build → publish → verify → promote

The pipeline follows the staged publishing pattern established in Phase 2's design: packages SHALL NOT be published directly to `latest`. The stages are:

1. Build all 12 targets via `scripts/build-cli.ts`
2. Publish to `staging` dist-tag via `scripts/publish-cli.ts`
3. Verify all 13 packages (12 platform + wrapper) exist at the expected version
4. Promote to `latest` dist-tag via `distTagAdd()`
5. Create GitHub Release + Slack notification

All stages run within the existing `ci-release.ts` flow, replacing the current early-exit for private packages.

### 2. Verify script with retry/backoff

New `scripts/verify-cli.ts`. Uses `versionExists()` from `scripts/lib/npm.ts`. SHALL retry with exponential backoff (e.g., 1s, 2s, 4s, 8s, 16s — 5 attempts, ~31s max wait). SHALL exit non-zero if any package is missing after max retries.

**Why a separate script:** Keeps the verify logic isolated and testable. The CI release script calls it as a step, and it can also be run manually for debugging.

### 3. Promote script

New `scripts/promote-cli.ts`. Calls `distTagAdd(pkg, version, 'latest')` for all 13 packages. SHALL be idempotent — checks current `latest` version first via `latestVersion()` and skips packages already pointing to the target.

**Why a separate script:** Same rationale as verify — isolated, testable, manually runnable.

### 4. CI I/O extension

Extend `scripts/lib/ci-io.ts` with methods for running build, publish, verify, and promote. These SHALL be thin wrappers around shell commands, following the existing pattern so tests can mock individual steps.

**Alternatives considered:**

- Inline the shell commands in `ci-release.ts` — rejected because it breaks the established I/O adapter pattern and makes testing harder.

### 5. Build architecture

**See Open Question below.** This decision is deferred pending research on build times and resource requirements.

## Open Question: Build Architecture

**Status: Requires research before this design can be finalized.**

The core question: should the 12 cross-compiled binaries be built in a single CI job or across 12 parallel matrix jobs?

### Research checklist

- [ ] **Per-target build time** — Time `bun scripts/build-cli.ts --single` on the current platform. How long does a single `Bun.build({ compile: true })` cross-compilation take?
- [ ] **Full sequential build time** — Time `bun scripts/build-cli.ts` (all 12 targets) on a single machine. What's the total wall-clock for sequential builds?
- [ ] **Memory usage during cross-compilation** — Does `Bun.build({ compile: true })` with a cross-compilation target fit within `resource_class: small` (2GB RAM)? Or does it require `medium` (4GB)?
- [ ] **CI setup overhead** — How long does the `setup-mise` command take in the release workflow? (mise install + bun install + cache restore). This is the per-job overhead that gets multiplied by 12 in the matrix approach.
- [ ] **Workspace persistence cost** — How long does `persist_to_workspace` / `attach_workspace` take for a ~50MB binary? (12 persists + 1 attach)

### Option A: Single job (sequential)

One job on `resource_class: medium` or `large` runs `bun scripts/build-cli.ts` for all 12 targets, then publishes/verifies/promotes in the same job.

- **Pros**: Simple config, no workspace persistence, current build script works as-is, single setup overhead
- **Cons**: Wall-clock scales linearly with build count
- **Choose if**: Total sequential build time is under ~5 minutes

### Option B: Matrix fan-out / fan-in

12 parallel jobs via CircleCI matrix, each building one target with `persist_to_workspace`. A downstream publish job attaches the workspace and runs publish → verify → promote.

- **Pros**: Wall-clock ≈ single build time + overhead, scales if builds get slower
- **Cons**: 12x setup overhead (~30s each), workspace I/O, more complex config, requires modifying the build script to accept a target argument
- **Choose if**: Per-target build time exceeds ~60 seconds

### Decision criteria

Once the research items above are filled in, apply this rule:

> If **total sequential build time** (all 12) is under 5 minutes, choose Option A. If per-target build time exceeds 60 seconds, choose Option B. If in between, default to Option A (simplicity wins when the difference is marginal).

## Risks / Trade-offs

**[Registry propagation lag]** → Verify script retries with exponential backoff, bounded at ~31 seconds. If the registry is exceptionally slow, the job fails and can be re-run.

**[Partial promotion failure]** → If promote fails mid-way, some packages have `latest` pointing to the new version while others don't. Mitigation: promote is idempotent; re-running completes it. Users on `latest` see a consistent set because package managers resolve all `optionalDependencies` at install time from a single resolved version.

**[Resource class cost]** → Upgrading from `small` to `medium`/`large` increases per-job cost. Only runs on tag pushes (~2-4x per month), so the impact is negligible.

## File Layout

```
scripts/
├── ci-release.ts          # Modified — add private-package pipeline
├── verify-cli.ts          # New — registry verification with retry
├── promote-cli.ts         # New — dist-tag promotion
└── lib/
    └── ci-io.ts           # Extended — build/publish/verify/promote methods

.circleci/
└── release-src/
    └── jobs/
        └── release.yml    # Modified — resource class and/or matrix config
```

## Documentation Impact

No existing docs in `docs/` or `README.md` cover the CI release pipeline. No doc updates are needed. The OIDC setup guide (`OIDC-SETUP.md`) already exists and does not need changes.

## ADR Compliance

No existing ADRs cover CI release pipelines or CLI binary distribution. ADR-002 (Publish Flow) covers facet artifact publishing, which is unrelated. No ADR conflicts or drift detected.
