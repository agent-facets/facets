> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## Step Types

- **Verify** → CHECK. Run automated checks (tests, lint, type checks). If all checks pass, proceed. If anything fails, STOP and notify the user.
- **Implement** → WRITE. Make code changes — create, edit, or delete files.
- **Propose** → READ-ONLY + USER GATE. Show the user intended changes and ask for approval using the `question` tool. Do not write anything. Do not proceed until the user approves.
- **Explore** → READ-ONLY. Read files, search the codebase, investigate broadly. No writes allowed. Use this to understand the problem space before acting.
- **Review** → READ-ONLY + USER GATE. Analyze what was done or found, present findings to the user, and wait for feedback before proceeding.

## 1. Source grammar & version parser — Research

- [x] 1.1 Explore: existing source-detection / parsing in `packages/cli/src/commands/add/index.ts` and any helpers it imports — what's accepted today, where rejection happens, what error shape is used.
- [x] 1.2 Explore: review `npm/npm-package-arg/lib/npa.js` (path regex, SCP regex, hosted-git-info shorthand handling) to confirm the exact regexes we want to borrow, and capture the ISC license attribution requirement.
- [x] 1.3 Explore: search for every callsite that constructs or interprets a facet source string (manifest loaders, lockfile loaders, error formatters, tests) so the new types thread through without orphan branches.
- [x] 1.4 Propose: design the `Source` and `VersionSpec` tagged unions, the pure `parseSource` / `parseVersionSpec` functions, the rejection error shapes for `git+`, `^`, `~`, `>=`, `||`, `1.x`, and the equivalence rule that bare-name, `@latest`, and `@*` collapse to the same resolution path.

## 2. Source grammar & version parser — Implementation

- [x] 2.1 Implement: add `Source` tagged union (registry / git / local) in `packages/common/src/` with no optional discriminators per the type-design rules.
- [x] 2.2 Implement: add `VersionSpec` tagged union (`exact` / `majorWildcard` / `minorWildcard` / `wildcard` / `latest`) in `packages/common/src/`.
- [x] 2.3 Implement: add pure `parseSource(input: string): Source` with hard-error on `git+`, tolerate-and-strip `file:`, accept `github:`, SCP-style, `https://…/.git`, and path-detected forms; include npm-derived `PATH_RE` and `SCP_RE` with attribution comment.
- [x] 2.4 Implement: add pure `parseVersionSpec(input: string): VersionSpec` rejecting `^`, `~`, `>=`, `<`, `||`, hyphen ranges, and `x`-style placeholders with errors that point users at the supported wildcard form.
- [x] 2.5 Implement: collapse `latest`, bare-name, and `*` into the same downstream resolution branch in whichever caller layer consumes `VersionSpec`.
- [x] 2.6 Implement: unit tests for `parseSource` and `parseVersionSpec` covering every accepted form, every rejected form, the `latest`/bare/`*` equivalence, and round-trip stability of registry `name@version` strings.
- [x] 2.7 Verify: `bun check` passes; new parser tests run in `packages/common`.

## 3. Cache layer — Research

- [x] 3.1 Explore: review bun's `~/.bun/install/cache/` layout (extracted-not-tarballs, `name@version@@@n` shape) to confirm what we adopt and what we reject — we explicitly do NOT use the disambiguator suffix.
- [x] 3.2 Explore: check existing filesystem helpers in `packages/common/` (atomic writes, path utilities) so the cache module reuses them rather than reimplementing.
- [x] 3.3 Propose: lock down the cache directory layout (`~/.facets/cache/<name>@<version>/` for registry+git, `<name>@local/` for local), the `FACETS_CACHE_DIR` override precedence, the write-on-miss / never-evict policy, and the "cache is trusted, never re-hashed" invariant.

## 4. Cache layer — Implementation

- [x] 4.1 Implement: cache module exposing `cachePath(identity)`, `cacheGet(identity)`, `cachePut(identity, content)` — all sync where possible, all atomic via tmp-then-rename.
- [x] 4.2 Implement: `FACETS_CACHE_DIR` env override resolved at module load with precedence over the default.
- [x] 4.3 Implement: cache identity calculator distinguishing `name@version` (registry/git) from `name@local` (local) per the design.
- [x] 4.4 Implement: unit tests for cache get/put/miss, env override, atomic-write behavior under concurrent writers, and the local-vs-registry identity distinction.
- [x] 4.5 Verify: `bun check` passes; cache tests run.

## 5. Integrity protocol — Research

- [x] 5.1 Explore: review `.facet` archive shape (outer uncompressed tarball + inner compressed tarball + descriptor manifest) so we know exactly which bytes feed each integrity check.
- [x] 5.2 Explore: review existing hashing helpers and the lockfile integrity field semantics in `openspec/specs/installation/spec.md` and current loaders.
- [x] 5.3 Propose: codify the three-check protocol per the design — A=cache vs metadata, B=metadata vs archive manifest, C=archive manifest vs computed content; one-check protocol for git; zero-check for local; what each check defends against; the hard-stop error shape.

## 6. Integrity protocol — Implementation

- [x] 6.1 Implement: shared `verifyIntegrity` helper returning a discriminated result type; each variant of `Source` selects the appropriate check set.
- [x] 6.2 Implement: registry three-check pipeline (A, B, C) wired so any failure aborts before any asset is written.
- [x] 6.3 Implement: git one-check pipeline (computed-vs-lockfile) and local zero-check passthrough.
- [x] 6.4 Implement: integrity-mismatch error type that names the affected facet, the expected hash, the observed hash, and the check that failed.
- [x] 6.5 Implement: unit tests for each check passing/failing in isolation and for the abort-before-any-write guarantee.
- [x] 6.6 Verify: `bun check` passes; integrity tests run.

## 7. Registry stubs — Research

- [x] 7.1 Explore: read the proposal's "stubbed-but-batch-shaped from day one" decision and the design's registry section to lock the function signatures we expose now versus what real registry I/O would add later.
- [x] 7.2 Propose: signature for `resolveRegistryMetadataBatch(specs: ReadonlyArray<{ name: string; version: VersionSpec }>): Promise<RegistryMetadata[]>` and `downloadAndExtractFacet(meta: RegistryMetadata, dest: string): Promise<void>`, plus the `RegistryMetadata` shape.

## 8. Registry stubs — Implementation

- [x] 8.1 Implement: `resolveRegistryMetadataBatch` that throws `// TODO(registry):` with a clear "registry not yet available; use git or local sources" message.
- [x] 8.2 Implement: `downloadAndExtractFacet` that throws the same `// TODO(registry):` error shape.
- [x] 8.3 Implement: unit tests asserting both stubs throw the documented error and never make network calls.
- [x] 8.4 Verify: `bun check` passes.

## 9. Extract `runInstall` — Research

- [x] 9.1 Explore: read `packages/cli/src/commands/install/index.ts` (lines 30-240, especially `withFacetPlan` 399-479) to map the current pipeline: lock acquire → resolve → build → diff → materialize → drift cleanup → lockfile write → release.
- [x] 9.2 Explore: read `packages/cli/src/commands/install/materialize.ts`, `journal.ts`, `lockfile-io.ts`, `lockfile-guard.ts` to identify which helpers stay as-is and which need shape changes for the new flow.
- [x] 9.3 Explore: trace every consumer of the current install flow (the `install` command, any test harness, any other command that calls into materialize) so the extraction doesn't strand callers.
- [x] 9.4 Propose: the `runInstall(opts)` signature, the `onStage` event shape per facet, the lockfile-driven mode (skip resolve when entry already locked) vs the resolve-mode (when manifest entry has no lockfile coverage), and how the manifest snapshot/rollback contract is layered on top.

## 10. Extract `runInstall` — Implementation

- [x] 10.1 Implement: extract `runInstall(opts)` from `commands/install/index.ts` into a shared module both `add` and `install` import.
- [x] 10.2 Implement: route resolve / fetch through the cache module from §4 and the integrity helper from §6; wire the registry stubs from §8 into the registry branch of resolve.
- [x] 10.3 Implement: per-facet `onStage` event emission (resolve-start, resolve-end, fetch-start, fetch-end, verify, materialize-start, materialize-end, lockfile-write, error).
- [x] 10.4 Implement: lockfile-driven install path that fetches+verifies lockfile-recorded entries without re-resolving against the registry; only newly-introduced manifest entries trigger resolution.
- [x] 10.5 Implement: composition rejection — when a facet's manifest declares `facets`, hard-error before any state mutation, identifying the composing facet by name.
- [x] 10.6 Implement: server-declaration handling — collect declared servers per facet, expose them on the result for the view to render, never materialize.
- [x] 10.7 Implement: unit tests for `runInstall` against a fake source resolver covering single-facet, multi-facet, lockfile-only mode, mixed lockfile+new-entry mode, integrity abort (no writes), composition reject (no writes), server-declaration passthrough.
- [x] 10.8 Verify: `bun check` passes; existing install e2e tests still pass against the extracted flow.

## 11. Shared `<InstallView />` — Research

- [x] 11.1 Explore: read the existing Ink `BuildView` in `packages/cli/src/commands/build.ts` for shape, mounting pattern, render-on-empty handling, and stderr/stdout separation.
- [x] 11.2 Explore: review the existing `InstallPicker` in `packages/cli/src/commands/adapter/install-picker.tsx` so the unmount/handoff between view and picker matches existing conventions.
- [x] 11.3 Propose: `<InstallView />` props (per-facet stage map, summary, server warnings, errors), single-facet detail vs multi-facet aggregate switch, the bun-style `+ name@version` summary line shape, the `(was X → Y)` re-add line, the empty-bundle "Bundle contains: nothing." line, the integrity-error in-view rendering, and the `--verbose` ↔ stderr split.

## 12. Shared `<InstallView />` — Implementation

- [x] 12.1 Implement: `<InstallView />` Ink component subscribing to `runInstall`'s `onStage` event stream.
- [x] 12.2 Implement: single-facet detail rendering (per-stage spinner/check/X with facet name).
- [x] 12.3 Implement: multi-facet aggregate rendering (one summary line per facet at completion).
- [x] 12.4 Implement: server-warning line: `⚠ <n> server(s) declared (<names>) — server installation not yet supported, skipping.\n  See https://docs.facets.io/servers for status.`
- [x] 12.5 Implement: re-add update line `+ name@new (was old → new)` for version changes; unchanged re-add renders idempotent re-materialize summary.
- [x] 12.6 Implement: empty-bundle case renders `Bundle contains: nothing.` plus the explanatory line.
- [x] 12.7 Implement: integrity-mismatch view state (no separate stderr path; rendered as view error with facet name, expected/observed hashes, failed-check identification).
- [x] 12.8 Implement: `--verbose` flag wired to emit diagnostic output on stderr without disturbing the view on stdout.
- [x] 12.9 Implement: component-level tests using `ink-testing-library` for each render branch above.
- [x] 12.10 Verify: `bun check` passes; view tests run.

## 13. Rewrite `commands/install` — Research

- [x] 13.1 Explore: re-read current `commands/install/index.ts` to identify any flag, exit code, or output behavior that must be preserved for backward compatibility.
- [x] 13.2 Propose: the new `install` command surface — no positional args (reject with usage error pointing at `add`), mounts `<InstallView />`, passes `lockfileDriven: true` to `runInstall`, exits 0 on no-op.

## 14. Rewrite `commands/install` — Implementation

- [x] 14.1 Implement: replace the body of `commands/install/index.ts` with the new flow: validate no positional args, mount `<InstallView />`, await `runInstall({ lockfileDriven: true })`, exit on result.
- [x] 14.2 Implement: positional-arg rejection with error directing the user to `add`.
- [x] 14.3 Implement: e2e test — lockfile honored verbatim, no registry resolution, no-op renders empty summary and exits 0, positional args rejected.
- [x] 14.4 Verify: `bun check` and `bun run --cwd packages/cli test:e2e` pass.

## 15. Rewrite `commands/add` — Research

- [x] 15.1 Explore: re-read `packages/cli/src/commands/add/index.ts` (lines 21-126) to identify what survives (manifest editing, arg parsing) and what gets replaced (everything after manifest write).
- [x] 15.2 Explore: review the adapter picker entry path in `commands/adapter/index.ts` (lines 85-156) to confirm the function signature for `pickAndInstallAdapters()` (returns `{ installedAdapters, aborted }`).
- [x] 15.3 Propose: end-to-end `add` flow — parse all sources up front (any parse error aborts before mutation), byte-snapshot `facets.json`, check adapter selection (TTY → picker, non-TTY → fail), pre-resolve metadata for unspecified versions to compute the pinned form, write manifest, call `runInstall` (which owns lockfile/materialize atomicity), restore manifest snapshot on any downstream failure.

## 16. Rewrite `commands/add` — Implementation

- [x] 16.1 Implement: positional-arg validation — at least one source required; multi-source supported.
- [x] 16.2 Implement: parse every source via `parseSource` / `parseVersionSpec` before any I/O; first parse error aborts with no state change.
- [x] 16.3 Implement: composition pre-check — if any incoming source's manifest declares `facets`, hard-error before manifest mutation.
- [x] 16.4 Implement: zero-adapter handling — TTY launches `pickAndInstallAdapters()`; user-cancel exits without modification; non-TTY exits non-zero with error pointing at interactive selection.
- [x] 16.5 Implement: byte-level snapshot of `facets.json` before any mutation; restore on any downstream failure; assert restored bytes equal pre-snapshot bytes.
- [x] 16.6 Implement: pre-resolve metadata for `unspecified` / `latest` / bare versions to obtain the exact published version, then write `name@MAJOR.MINOR.PATCH` to the manifest (default-to-pinned).
- [x] 16.7 Implement: wildcard versions are written as-written (e.g., `name@1.*`) to the manifest, with the resolved exact version going only to the lockfile.
- [x] 16.8 Implement: re-add path — detect existing entry, capture old version for the `(was X → Y)` summary, write new manifest entry; idempotent re-add (same resolved version) re-materializes via `runInstall`.
- [x] 16.9 Implement: invoke `runInstall({ lockfileDriven: false })` after manifest write; surface `onStage` events to the same `<InstallView />`.
- [x] 16.10 Implement: e2e tests — registry add (against stub error path), git add, local add, multi-source add, `@latest` ↔ bare equivalence (assert identical manifest+lockfile bytes), `^`/`~`/`git+` rejection, composition rejection, server warning rendering, zero-adapter TTY picker auto-launch, zero-adapter non-TTY failure, integrity mismatch leaves project unchanged, manifest rollback on downstream failure (assert byte equality).
- [x] 16.11 Verify: `bun check` and `bun run --cwd packages/cli test:e2e` pass.

## 17. Documentation sync — Research

- [ ] 17.1 Explore: scan `docs/` and the root `README.md` for every reference to `facet add`, `facet install`, source grammar, `git+` examples, install behavior, and lockfile semantics so the doc updates are exhaustive.
- [ ] 17.2 Propose: per-file change list — `docs/cli/add.md` (combined flow, source grammar, default-to-pinned, `@latest` equivalence, examples), `docs/cli/install.md` (lockfile-driven behavior, no positional args, no re-resolve, deferred `facet update`), `README.md` quick-start (drop separate `facet install` step), `CHANGELOG.md` entry.

## 18. Documentation sync — Implementation

- [ ] 18.1 Implement: rewrite `docs/cli/add.md` per the proposed change list.
- [ ] 18.2 Implement: rewrite `docs/cli/install.md` per the proposed change list.
- [ ] 18.3 Implement: update `README.md` quick-start to drop the standalone `facet install` step.
- [ ] 18.4 Implement: add `CHANGELOG.md` entry summarizing the combined-flow change, the new source grammar, the `@latest` alias, the lockfile-driven install model, and the cache+integrity protocol.
- [ ] 18.5 Verify: `bun check` passes; doc links resolve; quick-start example actually works against the new commands.

## 19. Final integration — Implementation

- [ ] 19.1 Implement: run the full repo `bun check` end-to-end and fix any cross-package fallout from the new types in `packages/common`.
- [ ] 19.2 Implement: smoke-test the user-visible flows manually — `facet add ./local-facet`, `facet add github:owner/repo`, `facet install` (no-op + lockfile-driven), `facet add` in a no-adapter project (TTY picker), `facet add` in CI (non-TTY failure).
- [ ] 19.3 Verify: every spec scenario from `specs/installation/spec.md` and `specs/cli/spec.md` is covered by at least one unit or e2e test; gap list is empty.
