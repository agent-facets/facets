> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## Step Types

- **Verify** → CHECK. Run automated checks (tests, lint, type checks).
  If all checks pass, proceed. If anything fails, STOP and notify the user.
- **Implement** → WRITE. Make code changes — create, edit, or delete files.
- **Propose** → READ-ONLY + USER GATE. Present intended changes in your message text first,
  then ask for approval using the `question` tool with a short prompt (Approve / Reject / Request changes).
  Never put details in the question — the question is just the gate. Do not write anything.
- **Explore** → READ-ONLY. Read files, search the codebase, investigate broadly.
  No writes allowed. Use this to understand the problem space before acting.
- **Review** → READ-ONLY + USER GATE. Present findings and analysis in your message text first,
  then ask for feedback using the `question` tool with a short prompt.
  Never put details in the question — the question is just the gate.

## 1. Snapshot refresh + engine dependency

- [x] 1.1 Implement: Add the `ini` package as a dependency of `@agent-facets/engine`.
- [x] 1.2 Implement: Run `bun run codegen:registry` (in `packages/engine`) to regenerate `openapi.snapshot.yaml`, the generated registry types, and the curated wire re-exports against the live registry.
- [x] 1.3 Verify: Confirm the regenerated snapshot contains the BearerAuth security scheme, the `/v0/facets/*` paths (publish, info, version-metadata, archive), the expanded error-code enum, and the required `fix` field on the error envelope.

## 2. Credential resolution + INI credentials file — Research

- [x] 2.1 Explore: the facet-dir module (`packages/engine/src/facet-dir.ts`): the existing `facetCacheDir()` / `facetAdaptersDir()` helper pattern, how `$FACET_DIR` is resolved and defaulted, and where a `facetCredentialsPath()` helper should slot in.
- [x] 2.2 Explore: the `ini` package API: parse, stringify, how it handles missing files, comment markers, and value trimming — confirm the exact calls for reading/writing a single `[default]` section with a `token` key.
- [x] 2.3 Explore: the repo's discriminated-result conventions (e.g. `Validated<T>`, `LoadLockfileResult`) to mirror the result shape for the credential resolver's three arms (env / file / absent).
- [x] 2.4 Propose: the engine credential module: the resolver's discriminated return type (naming the source), the `facetCredentialsPath()` helper, and the INI read/write functions (mode 600 on write), per D2 and D8.

## 3. Credential resolution + INI credentials file — Implementation

- [x] 3.1 Implement: Add `facetCredentialsPath()` to the facet-dir module returning `$FACET_DIR/credentials`.
- [x] 3.2 Implement: INI credentials read/write using `ini`: read the `[default]` section's `token`; write the file with mode 600; treat an absent file as "no credential" (not an error).
- [x] 3.3 Implement: the credential resolver with precedence `FACET_TOKEN` (non-empty trimmed) → credentials file → absent, returning a discriminated result that names the supplying source.
- [x] 3.4 Implement: unit tests — env-over-file precedence, file-only, env-only, absent, empty/whitespace `FACET_TOKEN` treated as absent, and mode-600 on written files.
- [x] 3.5 Verify: run `bun check` for the engine credential + facet-dir changes. (Scoped: credentials.ts + facet-dir.ts typecheck clean and 20/20 unit tests pass; the 10 remaining type errors are the snapshot-refresh fallout in publish.ts/resolve-metadata.ts/client.test.ts, fixed in Blocks 6–7.)

## 4. Bearer injection + registry-dumb error translation — Research

- [x] 4.1 Explore: `createRegistryClient` (`packages/engine/src/registry/client.ts`): the current timeout/retry middleware wiring and where a request middleware that attaches `Authorization: Bearer` should be added.
- [x] 4.2 Explore: the engine wire-error translation (`translateWireError` in `client.ts`): how structured envelopes are currently collapsed into `REGISTRY_NOT_AVAILABLE`, and what a `RegistryError` variant preserving `code`/`error`/`fix`/`docsUrl` requires.
- [x] 4.3 Explore: the CLI error-rendering layer (`packages/cli/src/util/registry-errors.ts`): the `whatForCode` / `fixForCode` / `docsUrlFor` maps and the `wireCode`-routing branch to be removed, and how the bridge renders an error today.
- [x] 4.4 Propose: the approach for the whole block — the optional-credential signature for `createRegistryClient`, the Bearer middleware, the `RegistryError` envelope-preserving variant, the deletions in the CLI error layer, and the two CLI-authored cases (pre-flight, unparseable response) per D3 and D4. (Approved: verbatim variant named `REGISTRY_REJECTED`; non-envelope case is `UNPARSEABLE_RESPONSE`.)

## 5. Bearer injection + registry-dumb error translation — Implementation

- [x] 5.1 Implement: Extend `createRegistryClient` to accept an optional credential and attach `Authorization: Bearer <token>` to every request via middleware when present; send no auth header when absent. The factory itself does no env/file I/O.
- [x] 5.2 Implement: Change the engine wire-error translation to stop collapsing structured envelopes; add a `RegistryError` variant carrying `code`, `error`, `fix`, and `docsUrl` verbatim.
- [x] 5.3 Implement: Delete `whatForCode`, `fixForCode`, `docsUrlFor`, and the `wireCode`-routing branch from the CLI error layer; render the registry's `error` + `fix` verbatim from the `RegistryError` variant.
- [x] 5.4 Implement: the CLI-authored "unparseable registry response" message (no docs link) for responses that are not a valid structured envelope; keep the existing pre-flight messages (missing credential, missing `facet.json`, network unreachable) as CLI-authored.
- [x] 5.5 Implement: Update tests — registry-client auth-header behavior (present/absent), wire-error translation preserving the envelope, and CLI rendering of verbatim vs CLI-authored cases.
- [x] 5.6 Verify: run `bun check` for the engine client + CLI error-rendering changes. (Scoped: all block-5 files typecheck clean and their tests pass — engine 25, CLI 6. The remaining type errors are isolated to publish.ts/resolve-metadata.ts/publish-cmd/search-cmd, fixed in Blocks 6–7.)

## 6. Publish + reads repointed to the new contract — Research

- [x] 6.1 Explore: the publish command + engine publish path (`packages/cli/src/commands/publish/index.ts`, `packages/engine/src/registry/publish.ts`): the current inline `X-Api-Key` header, the `FACET_REGISTRY_API_KEY` read, the publish path literal, and the success/status handling (including where a `202 QUEUED_FOR_REVIEW` outcome would land).
- [x] 6.2 Explore: the archive-download path (`packages/engine/src/registry/resolve-metadata.ts`, `download.ts`): the hand-built archive URL and the current `fetch(..., { redirect: 'follow' })`, to route the archive request through the typed client with `redirect: 'manual'`, read `Location`, then raw-fetch the presigned S3 URL (per D1).
- [x] 6.3 Explore: the search command (`packages/cli/src/commands/search/index.ts`) and any other read call sites for remaining `/v0/packages` literals or hand-built paths.
- [x] 6.4 Propose: the approach — publish resolves the credential via the D2 resolver (required, fail-fast) and passes it to `createRegistryClient`; reads resolve opportunistically and pass it through; the archive manual-redirect flow; and the `202` success handling. (Approved: `PublishResult` collapses to `{published|queued}`, errors via standard `RegistryResult` with `E_VERSION_EXISTS` rendered verbatim; archive 302→S3 resolved just-in-time inside `download.ts` per Option 3 — `RegistryMetadata` drops `tarballUrl`; reads carry the credential opportunistically.)

## 7. Publish + reads repointed to the new contract — Implementation

- [x] 7.1 Implement: Rewrite publish to resolve the credential via the resolver, fail fast with a CLI-authored message when absent, and pass the credential to `createRegistryClient` (removing the inline `X-Api-Key` header and the `FACET_REGISTRY_API_KEY` read).
- [x] 7.2 Implement: Handle the `202 QUEUED_FOR_REVIEW` publish outcome as a success — render the registry's queue-acknowledgement message and exit 0.
- [x] 7.3 Implement: Route the archive request through the typed client against `/v0/facets/{name}/{version}/archive` with `redirect: 'manual'`; read the `Location` header and raw-fetch the presigned S3 URL to stream the tarball; eliminate the hand-built archive URL.
- [x] 7.4 Implement: Repoint read commands (search and any remaining call sites) to resolve the credential opportunistically and pass it through; remove any lingering `/v0/packages` literals.
- [x] 7.5 Implement: Update tests — publish auth + no-credential fail-fast + 202 success; archive manual-redirect + S3 fetch; search against the new path.
- [x] 7.6 Verify: run `bun check` for the publish + read-path changes. (Engine + CLI both typecheck clean; engine 433 tests pass, CLI 181 pass; zero lingering `/v0/packages`, `FACET_REGISTRY_API_KEY`, or `X-Api-Key` references in source; biome lint clean on changed files.)

## 8. login / whoami / logout commands — Research

- [x] 8.1 Explore: the command registration pattern (`packages/cli/src/commands.ts` and an existing per-command module such as `self-update`): how commands are registered, how metadata-driven help is derived, and the module/folder layout to mirror for three new commands.
- [x] 8.2 Explore: the CLI TUI prompt primitives — a menu/selection component for the login menu (active "paste PAT" + disabled "coming soon" browser option) and a masked-input prompt (asterisks per character).
- [x] 8.3 Explore: the `GET /v0/auth/me` typed call in the refreshed snapshot — the response fields (username, email, tier, suspension state) used by `login` verification and `whoami`.
- [x] 8.4 Propose: the approach for all three commands — `login` (menu → masked input → verify via `/v0/auth/me` with the pasted token → write file → confirm, reject→reprompt, env-precedence notice), `whoami` (resolve → `/v0/auth/me` → print profile + env-source indication, not-logged-in path), `logout` (delete file, no-op-if-absent, env-still-active warning), and their registration, per D5/D6/D7. (Approved: `fetchAuthMe` engine helper in `registry/auth.ts`; login always shows the 2-row menu with the disabled "coming soon" browser option per D5; masked PAT via `ink-text-input`.)

## 9. login / whoami / logout commands — Implementation

- [x] 9.1 Implement: `facet login` — present the two-option menu (active paste-PAT / disabled "coming soon" browser); on paste, take masked input, verify the pasted token against `GET /v0/auth/me`, write it to the credentials file on success and print `Logged in as <username> (<tier>)`, render the registry's error and reprompt on rejection; show the env-precedence notice before prompting when `FACET_TOKEN` is set.
- [x] 9.2 Implement: `facet whoami` — resolve the credential, call `GET /v0/auth/me`, print username/email/tier/suspension; indicate when the credential came from `FACET_TOKEN`; print a clear "not logged in" message (non-zero exit) when no credential is resolvable.
- [x] 9.3 Implement: `facet logout` — delete the credentials file (report plainly when absent, exit 0), make no server call, and warn that the env var is still active (directing to `unset FACET_TOKEN`) when `FACET_TOKEN` is set.
- [x] 9.4 Implement: Register `login`, `whoami`, and `logout` in the command registry following the per-command pattern; no aliases.
- [x] 9.5 Implement: Add tests — login menu/masked-input/reprompt-error (LoginMenu component); whoami profile + env-source + not-logged-in + verbatim error; logout delete + no-op + env-warning; registration + help listing (unit + e2e). `fetchAuthMe` verify-before-save path exercised via whoami's identical engine call.
- [x] 9.6 Verify: run `bun check` for the new commands and registration. (Full monorepo `bun check` green — lint, types, unit, and e2e all pass; the e2e help test confirms login/logout/whoami are listed in `facet --help`.)

## 10. Documentation + final verification

- [x] 10.1 Implement: Document the publish auth flow. (Actual home corrected: `docs/docs/contributing/publishing.md` is npm-OIDC CI publishing, NOT `facet publish` — it had no `FACET_REGISTRY_API_KEY` to replace. Added an Authentication section + `login`/`whoami`/`logout` table + 202 review-queue note + the new `[directory]` arg to the canonical `docs/specification/publish.md`.)
- [x] 10.2 Implement: Update `docs/specification/install.md`. (N/A — verified: the install spec describes registry fetch abstractly and contains no literal `/v0/packages` path or fetch-contract path to repoint. No stale references exist anywhere in `docs/`.)
- [x] 10.3 Implement: Add a `docs/changelog/index.md` entry recording the breaking removal of `FACET_REGISTRY_API_KEY`, the endpoint rename, and the new `login`/`whoami`/`logout` commands. (Added a `2026-06-05` `<Update>` tagged `CLI`/`Breaking`/`New Feature` with `rss` prop, per the changelog authoring rules.)
- [x] 10.4 Implement: README "Publishing" section. (N/A-with-note: the README's existing "Publishing" section is about npm package releases (changesets); facet-publishing auth belongs in the docs site, not a redundant README blurb that would collide conceptually. Documented in publish.md instead per 10.1.)
- [x] 10.5 Verify: run the full `bun check` across the monorepo and confirm the change's specs are satisfied end-to-end. (Full `bun check` green — lint, types, unit, e2e (44), root scripts, and docs validate + broken-links all pass. `openspec validate update-cli-registry-auth --strict` passes. Live publish against the real registry confirmed end-to-end.)
