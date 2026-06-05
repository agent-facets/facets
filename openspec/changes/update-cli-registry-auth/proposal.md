## Why

The facet.cafe registry shipped a coordinated rework that renamed every
versioned endpoint from `/v0/packages/*` to `/v0/facets/*` and replaced the
static `X-Api-Key` header with `Authorization: Bearer <credential>` (a Cognito
JWT or an opaque `fct_pub_*` personal-access token minted in the web UI). The
CLI's vendored OpenAPI snapshot is from before that cut, so the CLI is
broken end-to-end against production today — `facet publish`, `facet add`,
`facet install`, and `facet search` all call paths the registry no longer
serves, and even if they reached the new paths, publish would be rejected
for sending the wrong auth header.

Production Cognito does NOT permit a CLI loopback callback URL, so a
browser-based PKCE sign-in flow cannot be deployed in this change. The
registry team's coordinated CLI contract (`facet-cafe` design D14,
archived change `2026-06-03-add-v0-publish-flow`) anticipates a
PAT-first V0: the user mints a `fct_pub_*` token in the web UI and
the CLI consumes it. This change is the CLI half of that coordinated
cut, with a guided `facet login` command as the on-ramp so the
PAT-paste path is discoverable and the future browser-sign-in path
has a place to land without further command-surface change.

## What Changes

- **BREAKING — Endpoint rename**: every registry call updates from
  `/v0/packages/*` to `/v0/facets/*`. Affects publish, version-metadata
  resolution, archive download, info, and search.
- **BREAKING — Auth scheme**: the publish header changes from
  `X-Api-Key: <key>` to `Authorization: Bearer <token>`. The
  credential source environment variable `FACET_REGISTRY_API_KEY` is
  **removed outright** (no dual-read, no deprecation shim, per the
  coordinated contract). Two new credential sources replace it: the
  `FACET_TOKEN` environment variable (preferred for CI), and a
  credentials file at `$FACET_DIR/credentials` (mode 600, written by
  `facet login`). The credentials file is INI-formatted with a
  `[default]` profile section (AWS-CLI style), holding a single
  `token` key in V0 — the profile structure is the seam for future
  multi-profile / multi-registry credentials. When both sources are
  present, `FACET_TOKEN` SHALL take precedence. `FACET_DIR` is the
  existing root for all on-disk CLI state and defaults to `~/.facet/`;
  the credentials file inherits that default.
- **Snapshot refresh**: regenerate `openapi.snapshot.yaml` and the
  generated types via `bun run codegen:registry`. The Bearer security
  scheme, the renamed paths, the expanded error-code enum, and the
  `fix` field on the error envelope all land in one regeneration. The
  one registry URL still built by hand today (the archive-download URL)
  SHALL be eliminated: the archive request is routed through the typed
  client so that no registry request path lives outside the generated
  contract.
- **New command `facet login`**: a guided sign-in flow. The user is
  shown a menu with two options — *paste a personal access token*
  (available now) and *sign in via browser* (shown but disabled with
  a "coming soon" label). The PAT path prompts for the token with
  masked input (asterisks per character), verifies it by calling
  `GET /v0/auth/me`, and on success writes the token to
  `$FACET_DIR/credentials` and prints `Logged in as <username>
  (<tier>)`. Invalid or expired tokens are rejected with the
  registry's own error text and the user is reprompted. If
  `FACET_TOKEN` is already set in the environment when `login`
  begins, the user SHALL be shown an explicit notice before any
  prompt — naming the variable, stating that it will be used for
  every command instead of the file about to be written, and
  directing the user to `unset FACET_TOKEN` if they want the
  credentials file to take effect. The user MAY proceed past this
  notice (CI and scripted use cases legitimately want env-var
  precedence).
- **New command `facet whoami`**: prints the authenticated user's
  username, email, tier, and suspension state by calling
  `GET /v0/auth/me`. When `FACET_TOKEN` is set, the output SHALL
  indicate that the env var is the credential in use (so the user
  isn't confused about which token authenticated the call).
- **New command `facet logout`**: clears the local credentials file
  at `$FACET_DIR/credentials`. No server call; users revoke PATs in
  the web UI. If `FACET_TOKEN` is set in the environment when
  `logout` runs, the user SHALL be told that the file has been
  deleted but the env var is still active and directed to
  `unset FACET_TOKEN` to fully sign out of this shell.
- **The credential is sent whenever one exists**: when a credential is
  available (from `FACET_TOKEN` or the credentials file), it SHALL be
  attached to every registry request — reads (search, info,
  version-metadata, archive download) as well as writes — so the
  registry can apply a higher rate-limit tier to authenticated traffic
  (anonymous reads are expected to be aggressively rate-limited to deter
  bulk scraping). Reads with no credential available SHALL remain fully
  functional, sent anonymously. The CLI never inspects the token it
  holds; whether a bad token is tolerated on an anonymous-readable
  endpoint is the registry's decision.
- **Registry-dumb error rendering**: when the registry returns its
  structured `{ code, error, fix, docsUrl }` envelope, the user sees
  the registry's own `error` + `fix` text verbatim. The CLI's local
  code-to-message map is **removed** — the CLI no longer needs to know
  what any registry error code means. The CLI authors its own message
  in only two situations, neither of which is a registry-returned
  code: the three pre-flight failures the registry never sees (missing
  credential, missing `facet.json`, unreachable network), and the case
  where the registry replies with something that is not a valid
  structured envelope at all (in which case the CLI states plainly
  that it could not process the response and does not redirect the
  user anywhere).
- **Publish queue-for-review handling**: when a first-time global-facet
  publish is accepted into the registry's review queue (HTTP 202), the
  publish command exits 0 and renders the registry's queue message
  verbatim. This is a success outcome, not a failure.

The `FACET_DIR` root (default `~/.facet/`) is already the single
on-disk convention in this repo, consolidated in the 2026-05-14
changelog with no automatic migration from the legacy `~/.facets/`;
no rename work is required.

## Capabilities

### New Capabilities

None. All work fits within the existing `cli` domain.

### Modified Capabilities

- `cli`: the credential a user supplies for publishing changes from
  `FACET_REGISTRY_API_KEY` to `FACET_TOKEN` (env), with a fallback
  to a credentials file at `$FACET_DIR/credentials` (default
  `~/.facet/credentials`); publish authenticates as a Bearer token
  rather than an API key; three new commands (`login`, `whoami`,
  `logout`) become available; the registry-contract view tracked by
  the CLI's vendored OpenAPI snapshot moves from the legacy
  `/v0/packages/*` surface to the renamed `/v0/facets/*` surface;
  registry-originated errors render the registry's own `error` and
  `fix` text verbatim, and the CLI no longer maintains a local
  code-to-message map for them.

## Impact

- **Affected areas**: the engine's registry HTTP client and its vendored
  OpenAPI snapshot; engine credential resolution (new); CLI commands
  (`publish`, `search`, new `login`, new `whoami`, new `logout`); CLI
  error rendering. The file-by-file map and the chosen module
  boundaries live in `design.md`.
- **Dependencies**: a single new dependency (`ini`) is added to the
  engine for parsing/serializing the INI credentials file; the rationale
  is in `design.md`.
- **Tests**: publish, registry-client, and error-rendering tests are
  updated; new tests cover credential resolution, `login`, `whoami`, and
  `logout`.
- **Documentation**: `docs/` publishing guidance updates from
  `FACET_REGISTRY_API_KEY` to `FACET_TOKEN`; a changelog entry records
  the breaking env-var removal and endpoint rename. The CLI README
  gains a short "Publishing" section pointing at the web UI for
  minting PATs. Existing docs informing this proposal:
  `docs/specification/install.md` (registry fetch contract),
  `docs/docs/contributing/publishing.md` (the current publish
  workflow), `docs/changelog/index.md` (the 2026-05-14 `~/.facet`
  consolidation entry that confirms no rename work is owed).
- **External coordination**: the registry side (`facet-cafe`) is
  already shipped; no further coordination is needed for this V0 cut.
  A future `facet login` (browser PKCE with a CLI loopback callback)
  requires a Cognito client URL addition on the registry side, tracked
  as a separate follow-up.

## Non-goals

- A working browser sign-in flow inside `facet login`. The option
  appears in the menu as a "coming soon" placeholder only; selecting
  it does nothing. A functional implementation depends on a
  registry-side Cognito callback URL addition for the CLI loopback
  port and is tracked as a separate follow-up.
- Local PKCE machinery, a local callback HTTP server, or any browser
  redirect handling in this change.
- CLI commands for token minting, listing, or revocation. The web UI
  is the workflow surface for these per the coordinated design.
- Server-side revocation of the PAT on `facet logout`. The user
  revokes PATs in the web UI; `logout` only clears the local file.
- Changes to the published archive format or to the bytes the publish
  command uploads. The publish body shape is unchanged.
- Any rename of `FACET_DIR` or its `~/.facet/` default. Already the
  single on-disk convention.
- Changes to the local pre-flight error messages (missing credential,
  missing `facet.json`, network unreachable). The registry-dumb
  rendering rule applies only to errors the registry returns.
