## Why

The CLI release pipeline skips the `agent-facets` package entirely — `ci-release.ts` exits early for private packages with a `TODO(binary-matrix)`. Phase 1 (`platform-builds`) built the cross-compilation tooling and Phase 2 (`platform-package-seeding`) created the per-platform npm packages and publish script, but without CI automation the CLI cannot actually be released to users. This is the final piece of the three-phase distribution plan.

## What Changes

- **Wire `ci-release.ts` to handle the CLI package.** When the tag matches `agent-facets@*`, the release script SHALL run the full pipeline: build all 12 platform binaries, publish to staging, verify registry propagation, promote to latest, create a GitHub Release, and notify Slack. The existing early-exit for private packages (lines 61–76) SHALL be replaced with this pipeline.
- **New `scripts/verify-cli.ts`.** Checks that every platform package and the wrapper exist at the expected version in the npm registry. SHALL retry with exponential backoff to handle registry propagation delay. Uses existing `versionExists()` from `scripts/lib/npm.ts`.
- **New `scripts/promote-cli.ts`.** Flips the `latest` dist-tag for all platform packages and the wrapper using `distTagAdd()` from `scripts/lib/npm.ts`. SHALL be idempotent — skips packages where `latest` already points to the target version.
- **Update the `release.yml` CI job.** The release job MAY need a larger resource class or a matrix fan-out to handle cross-compilation of 12 targets. The build architecture (single job vs. parallel matrix) is an open question to be resolved in the design phase based on measured per-target build times and CI spin-up overhead.
- **Extend `scripts/lib/ci-io.ts`.** Add methods for running the build, publish, verify, and promote scripts so they are mockable in tests.

## Open Question: Build Architecture

The 12 cross-compiled binaries can be built either in a single larger job (sequential, simpler config) or across 12 parallel matrix jobs (faster wall-clock, but ~30s setup overhead per job from `setup-mise`). The right choice depends on per-target `Bun.build({ compile: true })` times and whether `resource_class: small` has sufficient memory for cross-compilation. The design phase MUST measure these and commit to an architecture.

## Non-goals

- Homebrew, Docker, or other distribution channels
- Removing the redundant `check` job from the release workflow (separate concern)
- ARM CI runners (Bun cross-compiles from a single x64 Linux host)
- Changes to the changeset or tag-release workflows (already working correctly for private packages)

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `distribution`: Adding requirements for CI-automated release pipeline — build, publish, verify, and promote steps MUST run automatically on tag push.

## Impact

- **Scripts**: `scripts/ci-release.ts` (modified), `scripts/verify-cli.ts` (new), `scripts/promote-cli.ts` (new), `scripts/lib/ci-io.ts` (extended)
- **CI config**: `.circleci/release-src/` — the release job and potentially the release workflow
- **Dependencies**: Uses existing `scripts/build-cli.ts`, `scripts/publish-cli.ts`, and `scripts/lib/npm.ts` — no new external dependencies

## References

- **ADRs**: No existing ADRs cover CLI binary distribution or CI release pipelines. ADR-002 (Publish Flow) covers facet artifact publishing, which is unrelated.
- **Roadmap**: This work does not correspond to a numbered roadmap phase. The roadmap phases cover product capabilities (schemas, authoring, installation, integrity, etc.). CLI binary distribution is infrastructure supporting the product but is not itself a roadmap phase.
