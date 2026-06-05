## Context

The facet.cafe registry shipped a coordinated rework (registry repo
`facet-cafe`, archived change `2026-06-03-add-v0-publish-flow`). Two
breaking shifts land at once:

1. **Endpoint rename.** Every versioned path moved from `/v0/packages/*`
   to `/v0/facets/*` — publish, version-metadata, archive download,
   info, and search.
2. **Auth scheme.** The static `X-Api-Key` header was replaced with
   `Authorization: Bearer <credential>`, where the credential is either
   a Cognito JWT (interactive web session) or an opaque `fct_pub_*`
   personal access token minted in the web UI.

The CLI's vendored OpenAPI snapshot predates both shifts, so the CLI is
broken end-to-end against production: `publish`, `add`, `install`, and
`search` all call paths the registry no longer serves.

Current state worth naming precisely:

- The registry client factory (`createRegistryClient`) applies timeout
  and retry middleware only — no auth. The single auth header on the
  wire is set inline at the publish call site as `X-Api-Key`.
- The only credential read is `process.env.FACET_REGISTRY_API_KEY` in
  the publish command. No credential file, no `login`/`logout`/`whoami`
  commands exist.
- `$FACET_DIR` (default `~/.facet/`) is the established single root for
  all on-disk CLI state, with per-subsystem helpers (`facetCacheDir()`
  et al.). The legacy `~/.facets/` was retired with no migration.
- The deployed error envelope is `{ code, error, fix, docsUrl }` (all
  four required). The CLI today still carries a **local** code→message
  map (`whatForCode`/`fixForCode`) and deliberately prefers its own
  strings over the server's — a stopgap from when the envelope had no
  `fix` field. That stopgap now contradicts the registry's
  `api-conventions` spec, which states consumers SHALL NOT need a local
  code-to-meaning map for registry-originated codes.

Production Cognito permits no CLI loopback callback URL, so a
browser-based PKCE sign-in cannot ship in this change.

## Goals / Non-Goals

**Goals:**

- Repoint every registry call from `/v0/packages/*` to `/v0/facets/*`
  by refreshing the vendored OpenAPI snapshot, and eliminate the one
  hand-built registry URL so no registry path lives outside the
  generated contract.
- Replace `X-Api-Key` auth with `Authorization: Bearer`, sourced from
  `FACET_TOKEN` (env, preferred) with a `$FACET_DIR/credentials` file
  fallback.
- Centralize Bearer injection so the credential is attached whenever
  one is available — on reads as well as writes — to earn the
  authenticated rate-limit tier; reads with no credential remain
  functional anonymously.
- Add `facet login` (guided PAT paste + verify + save), `facet whoami`
  (profile readout), and `facet logout` (clear local credentials).
- Make the CLI fully registry-dumb for registry-origin errors: render
  the server's `error` and `fix` verbatim; delete the local code map.

**Non-Goals:**

- A working browser sign-in flow, local PKCE machinery, or a local
  callback server. The `facet login` menu shows a disabled "coming
  soon" option only.
- CLI commands for token mint/list/revoke (web UI owns those).
- Server-side PAT revocation on `logout`.
- Changes to the published archive bytes (`packFacetSource` output is
  unchanged; the new endpoint accepts the same `application/gzip` body).
- Any rename of `FACET_DIR` or its `~/.facet/` default.

## Decisions

### D1 — Refresh the snapshot; treat codegen as the source of the path rename

The endpoint rename SHALL land by running `bun run codegen:registry`
against the live registry, regenerating the OpenAPI snapshot, the
generated types, and the curated wire re-exports in one pass. The
Bearer security scheme, the renamed `/v0/facets/*` paths, the expanded
error-code enum, and the now-required `fix` field all arrive together.

No registry-facing request path SHALL be hand-built as a string
literal. Today the archive-download URL is assembled by hand
(`${base}/v0/packages/{name}/{version}/archive`) and handed to a raw
`fetch`, because the archive endpoint responds with a `302` redirect to
a short-lived presigned S3 URL rather than with bytes, and the typed
`openapi-fetch` client is shaped to parse a response body rather than
to stream bytes through a redirect chain. That hand-built path is the
exact failure mode this rename exposes: a literal `/v0/packages/...`
that a snapshot refresh does not touch, that breaks silently if a human
forgets it.

This change SHALL eliminate the hand-built registry path. The archive
request SHALL be issued through the typed client against
`/v0/facets/{name}/{version}/archive` with redirect-following disabled
(`redirect: 'manual'`), so the request path, its parameters, and any
future auth requirement all derive from the generated contract. The
client then reads the `Location` header off the `302` and performs a
raw `fetch` of THAT URL to stream the tarball bytes.

The presigned-S3 fetch is the only remaining raw, non-codegen request,
and it MUST stay that way: a presigned S3 URL is minted on the fly by
the registry and points at a different system; it is not — and never
will be — a registry endpoint in the OpenAPI spec. The line is drawn
exactly where reality draws it: every request the registry *serves* is
codegen-typed; only the off-spec S3 leg is raw.

*Why this matters beyond the current rename:* routing the archive
request through the typed client also means that if the registry ever
puts auth on the archive endpoint (e.g. private facets in a future
version), the Bearer credential flows through the same centralized
injection (see D3) with no new plumbing. A hand-built URL handed to a
bare `fetch` would silently send no credential.

*Alternative considered:* keep the hand-built archive URL and update it
by hand, optionally guarded by a test asserting it matches the snapshot
path. Rejected — it leaves a second source of truth for a registry path
and only *alarms* on drift rather than eliminating it; it also does not
survive a future auth-on-archive change.

*Alternative considered:* hand-edit only the publish path and leave the
rest of the snapshot stale. Rejected — search/install/download are also
broken against the live registry today; a partial fix ships a CLI that
still fails for read paths.

### D2 — Credential resolution: a single engine-side resolver, env-over-file

A new engine module SHALL own credential resolution with this
precedence:

1. `FACET_TOKEN` environment variable, when set to a non-empty
   (trimmed) value.
2. The token persisted at `$FACET_DIR/credentials`.
3. Absent — no credential available.

The resolver SHALL return a discriminated result that names which
source supplied the credential (or that none did), so callers can both
authenticate and render source-aware notices (e.g. `whoami` indicating
the env var is in use, `login`/`logout` warning that the env var
shadows the file). Modeling "absent" as an explicit arm — rather than
an empty string or `undefined` — keeps the missing-credential path a
compile-time obligation at every call site.

A new `facetCredentialsPath()` helper SHALL be added to the facet-dir
module alongside the existing `facetCacheDir()` / `facetAdaptersDir()`
helpers, returning `$FACET_DIR/credentials`. The credentials file SHALL
be written with mode `600` (owner read/write only). Its on-disk format
(INI with a `[default]` profile) is specified in D8.

*Alternative considered:* read the env var inline in each command, as
publish does today. Rejected — three commands now need the credential,
and the env-over-file precedence plus source-aware messaging is logic
that must not be duplicated.

### D3 — Bearer injection centralized in the client factory; send the credential whenever one exists

`createRegistryClient` SHALL accept an optional credential. When a
credential is present, the client SHALL attach `Authorization: Bearer
<token>` to **every** outgoing request via request middleware,
regardless of whether the call is a read or a write; when absent, no
auth header is sent. This removes the inline `X-Api-Key` header from the
publish call site and makes "do we have a credential?" a property of how
the client is constructed, not a per-call-site concern.

**Reads send the credential opportunistically.** The CLI does not
reserve the Bearer header for write calls. If a credential is available,
search, info, version-metadata, and archive-download requests carry it
too. The reason is server-side rate limiting: anonymous reads will be
aggressively rate-limited to deter bulk scanning/scraping, and
authenticated reads are expected to earn a higher limit. Sending the
credential on reads lets the registry apply the authenticated tier. A
read with no credential available remains fully functional — it is sent
anonymously and served at the anonymous limit.

**The CLI never inspects or validates the credential it holds.** If the
CLI has a credential, it sends it — expired, revoked, or malformed
included. The CLI does not pre-check token validity and does not
implement any "retry the read without the credential" degrade path.
What happens to a request bearing a bad token is entirely the
registry's decision: for a truly anonymous-readable endpoint the
registry MAY ignore the bad token and serve the read (falling back to
anonymous server-side); if the registry instead rejects the request,
that rejection is the registry's deliberate policy and the CLI renders
the returned `error`/`fix` verbatim per D4. This keeps the CLI dumb on
the read path exactly as it is dumb on the error-rendering path.

**Credential resolution stays with the caller (per D2).** Every command
resolves the credential via the D2 resolver and passes the result to
`createRegistryClient`. Publish *requires* a credential and fails fast
when none is available; read commands pass it *opportunistically* and
proceed anonymously when it is absent. The factory itself does no env or
file I/O — it is a pure "here is a credential, or not; build a client"
function, which keeps it trivially testable. The one exception is
`facet login`'s verification call, which authenticates with the
freshly-pasted token (see D5) rather than the resolved credential.

Token-expiry *management* (refresh, re-prompt on `401`) is explicitly
out of scope for this change: V0 is PAT-only, and PATs are long-lived
enough that a token will not lapse mid-workflow, so lifecycle handling
is deferred to a later phase.

*Alternative considered:* attach the Bearer header only on write calls
and keep reads strictly anonymous. Rejected — it forfeits the
authenticated rate-limit tier on reads for logged-in users, and a
read-vs-write branch in the auth layer is exactly the per-call coupling
this decision removes.

*Alternative considered:* have `createRegistryClient` resolve the
credential itself by default. Rejected — it couples the factory to the
resolver's env/file I/O, making the factory harder to test in isolation
and hiding the credential source from the call site.

*Alternative considered:* keep setting the header per-call. Rejected —
it scatters the auth decision across every command and repeats the "is
there a credential?" branch.

### D4 — Registry-dumb error rendering; delete the local code map

For any error the registry returns as a structured `{ code, error,
fix, docsUrl }` envelope, the CLI SHALL render the server's `error` and
`fix` text verbatim. The CLI-side `whatForCode()` and `fixForCode()`
maps SHALL be removed, along with the `wireCode`-routing branch that
preferred them over the server's text, and the synthesized
`docsUrlFor()` links for registry-origin codes.

To carry the server's text to the renderer without loss, the engine's
wire-error translation SHALL stop collapsing structured envelopes into
the generic `REGISTRY_NOT_AVAILABLE` discriminator. A `RegistryError`
variant SHALL preserve the envelope's `code`, `error`, `fix`, and
`docsUrl` verbatim. The CLI bridge renders those fields directly.

The CLI SHALL author its own message text in exactly two situations,
neither of which is a registry-returned error code:

1. **Pre-flight failures** that never reach the registry: no credential
   available, no `facet.json` in the working directory, and network
   unreachable / request aborted.
2. **Unparseable registry response**: the registry replied with
   something that is not a valid structured envelope (e.g. an HTML 502
   from a middlebox, an empty 503, raw text). The CLI SHALL render a
   plain message stating that the registry returned a response it could
   not process, and SHALL NOT synthesize a docs link or redirect for
   this case.

*Alternative considered:* keep the local map as a fallback for codes
the CLI recognizes. Rejected — it reintroduces the exact duplication
the registry's `api-conventions` spec forbids, and it goes stale every
time the registry adds or rewords a code. The registry now ships `fix`
on every error, so the gap that originally justified the map is closed.

### D5 — `facet login` is a guided, verifying flow

`facet login` SHALL present a menu with two options: *paste a personal
access token* (active) and *sign in via browser* (shown, disabled, with
a "coming soon" label). The PAT path SHALL:

1. Prompt for the token with masked input (asterisks per character).
2. Verify it by calling `GET /v0/auth/me` with the pasted token as a
   Bearer credential.
3. On success, write the token to `$FACET_DIR/credentials` (mode 600)
   and print `Logged in as <username> (<tier>)`.
4. On a registry rejection (401 or other), render the registry's own
   error/fix text and reprompt rather than persisting an unusable
   token.

If `FACET_TOKEN` is set in the environment when `login` begins, the
command SHALL display an explicit notice before prompting — naming the
variable, stating it will be used for every command in place of the
file about to be written, and directing the user to `unset FACET_TOKEN`
if they want the file to take effect. The user MAY proceed (CI and
scripted setups legitimately want env precedence).

*Alternative considered:* save the pasted token without verifying.
Rejected — a typo or expired paste would surface only at the next
publish; verifying at entry time fails fast with the registry's own
message.

### D6 — `whoami` and `logout` are thin and local-first

`facet whoami` SHALL call `GET /v0/auth/me` with the resolved
credential and print username, email, tier, and suspension state. When
the credential came from `FACET_TOKEN`, the output SHALL indicate the
env var is the credential in use. With no credential available, it
SHALL print a clear "not logged in" message directing the user to
`facet login` or to set `FACET_TOKEN`.

`facet logout` SHALL delete `$FACET_DIR/credentials` (a no-op if the
file is absent, reported plainly) and SHALL make no server call. When
`FACET_TOKEN` is set, it SHALL tell the user the file was removed but
the env var is still active and direct them to `unset FACET_TOKEN` to
fully sign out of the shell.

### D7 — Command registration

`login`, `whoami`, and `logout` SHALL be registered in the CLI command
registry following the existing per-command module pattern. No aliases
are introduced. Help text SHALL be derived from command metadata as the
existing commands do.

### D8 — Credentials file format: INI with a `[default]` profile

The credentials file at `$FACET_DIR/credentials` SHALL be **INI**
format, following the AWS-CLI `~/.aws/credentials` convention. The V0
file SHALL contain exactly one profile section, `[default]`, with a
single `token` key:

```ini
[default]
token = fct_pub_...
```

There SHALL be no version field. The profile-section structure is
itself the format contract — future format evolution adds keys or
sections rather than bumping a version number, exactly as AWS does.

INI (over JSON) is chosen deliberately for its forward path: the named
`[default]` section is the seam that lets later work add multiple named
profiles, per-registry credentials, and directory-scoped credential
resolution without a format break. JSON would model a single token
fine but would have to grow an ad-hoc profile convention to reach the
same place. V0 reads and writes only `[default]`; no `--profile` flag,
no multi-registry resolution, and no other sections are honored yet —
but the format does not have to change when they arrive.

Parsing and serialization SHALL use a small, well-established INI
library (the same `ini` package used widely for files like `.npmrc`)
rather than a hand-rolled parser. This is an auth-path parser handling
a secret, and INI's edge cases (inline `#`/`;` comment markers, value
quoting, whitespace trimming, duplicate keys) are exactly where a
hand-rolled subset silently corrupts a token and produces confusing
`401`s. Leaning on the audited library is the safe default and is the
foundation the multi-profile future builds on. This adds one
dependency to engine, which is acceptable for a credentials parser.

The file SHALL be written with mode `600` (per D2). `facet logout`
deletes the whole file (per D6); V0 has no per-profile removal because
V0 has only the one profile.

*Alternative considered:* JSON, consistent with every other file the
CLI writes and requiring no new dependency. Rejected — a single flat
token object does not carry the multi-profile / multi-registry future
the team wants, and retrofitting profiles onto JSON later would mean an
ad-hoc nested convention rather than the established INI profile model.

*Alternative considered:* hand-roll a minimal INI reader/writer to
avoid the dependency. Rejected — credentials parsing is
security-adjacent, INI has more edge cases than its surface suggests,
and the multi-profile future is exactly where a home-grown INI dialect
accumulates bugs.

## Risks / Trade-offs

- **[Snapshot drift between refresh and merge]** → The registry could
  change again between the codegen run and this change landing. The
  existing snapshot-freshness CI check bounds this; the refresh is
  idempotent, so re-running before merge resolves any drift.

- **[Registry `fix` text quality is now load-bearing]** → With the
  local map gone, a vague or missing server `fix` directly degrades the
  user's experience. Mitigation: the envelope makes `fix` required, and
  any weak `fix` text is a registry-side fix tracked in `facet-cafe`,
  not worked around in the CLI. The CLI's job is faithful rendering.

- **[`FACET_TOKEN` silently shadows the credentials file]** → A user
  who runs `login` then wonders why `logout` "didn't work" is the
  classic confusion. Mitigation: both `login` and `logout` emit an
  explicit env-precedence notice naming the variable and the `unset`
  remedy; `whoami` names the active source.

- **[Credentials file written to a shared/owner-readable location]** →
  A token at rest is a secret. Mitigation: mode `600`; the file lives
  under `$FACET_DIR` which the user already controls; `logout` deletes
  it; no server-side mint/refresh is stored.

- **[Verifying the token at login adds a network round-trip]** → A user
  offline at login time cannot complete the flow. Accepted — login is
  an interactive, online action by nature; the fail-fast benefit
  outweighs supporting offline login.

## Migration Plan

1. Run `bun run codegen:registry`; commit the regenerated snapshot,
   types, and wire re-exports. Confirm BearerAuth, `/v0/facets/*`
   paths, the `fix` field, and the expanded code enum are present.
2. Add the credential resolver module and `facetCredentialsPath()`;
   add the `ini` dependency and the INI credentials read/write per D8;
   add Bearer support to the client factory.
3. Rewrite publish to use the resolver + Bearer; route the archive
   request through the typed client with manual redirect handling (per
   D1, eliminating the hand-built archive path); and handle the
   `202 QUEUED_FOR_REVIEW` success outcome.
4. Add `login`, `whoami`, `logout`; register them.
5. Strip the local code map and `wireCode` routing; switch the engine
   wire-error translation to carry the structured envelope through.
6. Update tests; update docs (see below).

No data migration is required: there is no production publish data, no
stored `X-Api-Key` to migrate, and `~/.facet/` is already the single
on-disk convention. Rollback is a straight revert — nothing persists
irreversibly beyond a user's own credentials file, which `logout`
clears.

## Documentation Impact

This change alters observable CLI behavior, commands, and an
environment variable that user-facing documentation covers. The
following SHALL be updated as scoped work:

- `docs/docs/contributing/publishing.md` (or its current equivalent) —
  the publish workflow: replace `FACET_REGISTRY_API_KEY` guidance with
  the `facet login` / `FACET_TOKEN` flow; describe minting a PAT in the
  web UI.
- `docs/specification/install.md` — any reference to the registry fetch
  contract or `/v0/packages` paths shifts to `/v0/facets`.
- `docs/changelog/index.md` — a new entry recording the breaking
  removal of `FACET_REGISTRY_API_KEY`, the endpoint rename, and the new
  `login`/`whoami`/`logout` commands.
- Root `README.md` / CLI package README — a short "Publishing" section
  pointing at the web UI for PATs and documenting `facet login`.

No existing documentation conflicts with this design beyond the
`FACET_REGISTRY_API_KEY` references being superseded; those are the
updates enumerated above.
