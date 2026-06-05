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

- [ ] 1.1 Implement: Add the `ini` package as a dependency of `@agent-facets/engine`.
- [ ] 1.2 Implement: Run `bun run codegen:registry` (in `packages/engine`) to regenerate `openapi.snapshot.yaml`, the generated registry types, and the curated wire re-exports against the live registry.
- [ ] 1.3 Verify: Confirm the regenerated snapshot contains the BearerAuth security scheme, the `/v0/facets/*` paths (publish, info, version-metadata, archive), the expanded error-code enum, and the required `fix` field on the error envelope.

## 2. Credential resolution + INI credentials file — Research

- [ ] 2.1 Explore: the facet-dir module (`packages/engine/src/facet-dir.ts`): the existing `facetCacheDir()` / `facetAdaptersDir()` helper pattern, how `$FACET_DIR` is resolved and defaulted, and where a `facetCredentialsPath()` helper should slot in.
- [ ] 2.2 Explore: the `ini` package API: parse, stringify, how it handles missing files, comment markers, and value trimming — confirm the exact calls for reading/writing a single `[default]` section with a `token` key.
- [ ] 2.3 Explore: the repo's discriminated-result conventions (e.g. `Validated<T>`, `LoadLockfileResult`) to mirror the result shape for the credential resolver's three arms (env / file / absent).
- [ ] 2.4 Propose: the engine credential module: the resolver's discriminated return type (naming the source), the `facetCredentialsPath()` helper, and the INI read/write functions (mode 600 on write), per D2 and D8.

## 3. Credential resolution + INI credentials file — Implementation

- [ ] 3.1 Implement: Add `facetCredentialsPath()` to the facet-dir module returning `$FACET_DIR/credentials`.
- [ ] 3.2 Implement: INI credentials read/write using `ini`: read the `[default]` section's `token`; write the file with mode 600; treat an absent file as "no credential" (not an error).
- [ ] 3.3 Implement: the credential resolver with precedence `FACET_TOKEN` (non-empty trimmed) → credentials file → absent, returning a discriminated result that names the supplying source.
- [ ] 3.4 Implement: unit tests — env-over-file precedence, file-only, env-only, absent, empty/whitespace `FACET_TOKEN` treated as absent, and mode-600 on written files.
- [ ] 3.5 Verify: run `bun check` for the engine credential + facet-dir changes.

## 4. Bearer injection + registry-dumb error translation — Research

- [ ] 4.1 Explore: `createRegistryClient` (`packages/engine/src/registry/client.ts`): the current timeout/retry middleware wiring and where a request middleware that attaches `Authorization: Bearer` should be added.
- [ ] 4.2 Explore: the engine wire-error translation (`translateWireError` in `client.ts`): how structured envelopes are currently collapsed into `REGISTRY_NOT_AVAILABLE`, and what a `RegistryError` variant preserving `code`/`error`/`fix`/`docsUrl` requires.
- [ ] 4.3 Explore: the CLI error-rendering layer (`packages/cli/src/util/registry-errors.ts`): the `whatForCode` / `fixForCode` / `docsUrlFor` maps and the `wireCode`-routing branch to be removed, and how the bridge renders an error today.
- [ ] 4.4 Propose: the approach for the whole block — the optional-credential signature for `createRegistryClient`, the Bearer middleware, the `RegistryError` envelope-preserving variant, the deletions in the CLI error layer, and the two CLI-authored cases (pre-flight, unparseable response) per D3 and D4.

## 5. Bearer injection + registry-dumb error translation — Implementation

- [ ] 5.1 Implement: Extend `createRegistryClient` to accept an optional credential and attach `Authorization: Bearer <token>` to every request via middleware when present; send no auth header when absent. The factory itself does no env/file I/O.
- [ ] 5.2 Implement: Change the engine wire-error translation to stop collapsing structured envelopes; add a `RegistryError` variant carrying `code`, `error`, `fix`, and `docsUrl` verbatim.
- [ ] 5.3 Implement: Delete `whatForCode`, `fixForCode`, `docsUrlFor`, and the `wireCode`-routing branch from the CLI error layer; render the registry's `error` + `fix` verbatim from the `RegistryError` variant.
- [ ] 5.4 Implement: the CLI-authored "unparseable registry response" message (no docs link) for responses that are not a valid structured envelope; keep the existing pre-flight messages (missing credential, missing `facet.json`, network unreachable) as CLI-authored.
- [ ] 5.5 Implement: Update tests — registry-client auth-header behavior (present/absent), wire-error translation preserving the envelope, and CLI rendering of verbatim vs CLI-authored cases.
- [ ] 5.6 Verify: run `bun check` for the engine client + CLI error-rendering changes.

## 6. Publish + reads repointed to the new contract — Research

- [ ] 6.1 Explore: the publish command + engine publish path (`packages/cli/src/commands/publish/index.ts`, `packages/engine/src/registry/publish.ts`): the current inline `X-Api-Key` header, the `FACET_REGISTRY_API_KEY` read, the publish path literal, and the success/status handling (including where a `202 QUEUED_FOR_REVIEW` outcome would land).
- [ ] 6.2 Explore: the archive-download path (`packages/engine/src/registry/resolve-metadata.ts`, `download.ts`): the hand-built archive URL and the current `fetch(..., { redirect: 'follow' })`, to route the archive request through the typed client with `redirect: 'manual'`, read `Location`, then raw-fetch the presigned S3 URL (per D1).
- [ ] 6.3 Explore: the search command (`packages/cli/src/commands/search/index.ts`) and any other read call sites for remaining `/v0/packages` literals or hand-built paths.
- [ ] 6.4 Propose: the approach — publish resolves the credential via the D2 resolver (required, fail-fast) and passes it to `createRegistryClient`; reads resolve opportunistically and pass it through; the archive manual-redirect flow; and the `202` success handling.

## 7. Publish + reads repointed to the new contract — Implementation

- [ ] 7.1 Implement: Rewrite publish to resolve the credential via the resolver, fail fast with a CLI-authored message when absent, and pass the credential to `createRegistryClient` (removing the inline `X-Api-Key` header and the `FACET_REGISTRY_API_KEY` read).
- [ ] 7.2 Implement: Handle the `202 QUEUED_FOR_REVIEW` publish outcome as a success — render the registry's queue-acknowledgement message and exit 0.
- [ ] 7.3 Implement: Route the archive request through the typed client against `/v0/facets/{name}/{version}/archive` with `redirect: 'manual'`; read the `Location` header and raw-fetch the presigned S3 URL to stream the tarball; eliminate the hand-built archive URL.
- [ ] 7.4 Implement: Repoint read commands (search and any remaining call sites) to resolve the credential opportunistically and pass it through; remove any lingering `/v0/packages` literals.
- [ ] 7.5 Implement: Update tests — publish auth + no-credential fail-fast + 202 success; archive manual-redirect + S3 fetch; search against the new path.
- [ ] 7.6 Verify: run `bun check` for the publish + read-path changes.

## 8. login / whoami / logout commands — Research

- [ ] 8.1 Explore: the command registration pattern (`packages/cli/src/commands.ts` and an existing per-command module such as `self-update`): how commands are registered, how metadata-driven help is derived, and the module/folder layout to mirror for three new commands.
- [ ] 8.2 Explore: the CLI TUI prompt primitives — a menu/selection component for the login menu (active "paste PAT" + disabled "coming soon" browser option) and a masked-input prompt (asterisks per character).
- [ ] 8.3 Explore: the `GET /v0/auth/me` typed call in the refreshed snapshot — the response fields (username, email, tier, suspension state) used by `login` verification and `whoami`.
- [ ] 8.4 Propose: the approach for all three commands — `login` (menu → masked input → verify via `/v0/auth/me` with the pasted token → write file → confirm, reject→reprompt, env-precedence notice), `whoami` (resolve → `/v0/auth/me` → print profile + env-source indication, not-logged-in path), `logout` (delete file, no-op-if-absent, env-still-active warning), and their registration, per D5/D6/D7.

## 9. login / whoami / logout commands — Implementation

- [ ] 9.1 Implement: `facet login` — present the two-option menu (active paste-PAT / disabled "coming soon" browser); on paste, take masked input, verify the pasted token against `GET /v0/auth/me`, write it to the credentials file on success and print `Logged in as <username> (<tier>)`, render the registry's error and reprompt on rejection; show the env-precedence notice before prompting when `FACET_TOKEN` is set.
- [ ] 9.2 Implement: `facet whoami` — resolve the credential, call `GET /v0/auth/me`, print username/email/tier/suspension; indicate when the credential came from `FACET_TOKEN`; print a clear "not logged in" message (non-zero exit) when no credential is resolvable.
- [ ] 9.3 Implement: `facet logout` — delete the credentials file (report plainly when absent, exit 0), make no server call, and warn that the env var is still active (directing to `unset FACET_TOKEN`) when `FACET_TOKEN` is set.
- [ ] 9.4 Implement: Register `login`, `whoami`, and `logout` in the command registry following the per-command pattern; no aliases.
- [ ] 9.5 Implement: Add tests — login success/reject/reprompt + env-precedence notice + masked input + verify-before-save; whoami profile + env-source + not-logged-in; logout delete + no-op + env-warning; help lists all three commands.
- [ ] 9.6 Verify: run `bun check` for the new commands and registration.

## 10. Documentation + final verification

- [ ] 10.1 Implement: Update `docs/docs/contributing/publishing.md` — replace `FACET_REGISTRY_API_KEY` guidance with the `facet login` / `FACET_TOKEN` flow and describe minting a PAT in the web UI.
- [ ] 10.2 Implement: Update `docs/specification/install.md` — shift any `/v0/packages` references or registry fetch-contract details to `/v0/facets`.
- [ ] 10.3 Implement: Add a `docs/changelog/index.md` entry recording the breaking removal of `FACET_REGISTRY_API_KEY`, the endpoint rename, and the new `login`/`whoami`/`logout` commands.
- [ ] 10.4 Implement: Add a short "Publishing" section to the root `README.md` / CLI package README pointing at the web UI for PATs and documenting `facet login`.
- [ ] 10.5 Verify: run the full `bun check` across the monorepo and confirm the change's specs are satisfied end-to-end.
