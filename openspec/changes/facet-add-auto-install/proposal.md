## Why

`facet add <source>` today only edits `facets.json`; users run a separate
`facet install` to materialize assets into adapters. Every modern package
manager (npm, pnpm, bun, cargo) installs immediately on add, and
Time-To-Hello-World is the most-cited DX gap during onboarding. This
change makes `facet add` install on add, accept bare names via a
(stubbed) registry, simplify the git source grammar, ship a strict
asterisk-only version-range syntax with default-to-pinned storage,
introduce a content-addressed cache with an integrity-check protocol,
and surface declared MCP servers without yet materializing them — so the
command behaves like a modern package manager and the screenshot demo
works end-to-end.

## What Changes

- **Combined add-and-install.** `facet add <source>` SHALL resolve the
  source, write the new entry to `facets.json`, write the resolved entry
  to `facets.lock`, materialize into all selected adapters, and emit a
  rich progress view — all in a single command. Running `facet install`
  afterward SHALL no longer be required.
- **Bare-name registry resolution (stubbed).** `facet add <name>` SHALL
  route through a registry-metadata stub targeting `facets.cafe` with a
  `// TODO(registry):` body that throws a clear "not yet implemented"
  error. The metadata function SHALL be batch-shaped from day one
  (`resolveRegistryMetadataBatch`) so the eventual implementation can be
  parallel-fan-out today and a real batch endpoint later, with no caller
  changes. `facets.cafe` SHALL be the sole registry; no flag, env var,
  or config option selects an alternate.
- **Default-to-pinned with asterisk-only range syntax.** Bare
  `facet add <name>` SHALL pin the resolved exact version into
  `facets.json` (e.g. `viper-plans@1.2.3`). The supported range forms
  SHALL be `*` (any), `MAJOR.*`, `MAJOR.MINOR.*`, and exact
  `MAJOR.MINOR.PATCH` — no `^`, `~`, `>=`, `||`, or `1.x`. Other forms
  SHALL hard-error with a copyable suggestion.
- **Lockfile is the integrity contract.** `facets.lock` SHALL be
  committed to the repo. `facet install` SHALL be lockfile-driven —
  reading the lock, fetching exactly what it pins (downloading if cache
  miss), verifying integrity, materializing. It SHALL NOT re-resolve
  ranges. `facet update` (out of scope) is the only future command that
  re-resolves locked entries.
- **Content-addressed cache with three-check integrity protocol.** A
  new `~/.facets/cache/` directory (overridable via `FACETS_CACHE_DIR`)
  SHALL hold extracted facet content keyed by `<name>@<version>/` for
  registry/git sources and `<name>@local/` for local sources. Registry
  installs SHALL run three independent integrity checks (cache vs.
  metadata, metadata vs. archive manifest, archive manifest vs.
  computed content); any mismatch SHALL hard-error as a security event.
  Cached content SHALL be trusted; we do not re-hash on cache hits.
- **Simplified git source grammar.** Accepted forms SHALL be
  `github:<owner>/<repo>[#<ref>]`, SCP-style
  `git@<host>:<owner>/<repo>.git[#<ref>]` (new — enables GitLab,
  Bitbucket, Gitea, self-hosted), any `https://`/`http://`/`ssh://`/`git://`
  URL, and local paths starting with `./`, `../`, `/`, `\`, `~/`, or
  `<letter>:[/\\]`. The `git+` URL prefix SHALL be hard-rejected with
  an actionable error. The `file:` prefix SHALL be tolerated and
  stripped on storage. Authentication SHALL rely on the user's existing
  git configuration.
- **Servers listed, not materialized.** Facets declaring MCP `servers`
  SHALL install successfully; the bundle breakdown SHALL list server
  names, followed by a two-line warning
  (`⚠ <n> server(s) declared (<names>) — server installation not yet
  supported, skipping.` + a docs link). Server config SHALL NOT be
  written to any adapter; no auth flow. Lockfile entries SHALL NOT
  record server metadata.
- **Composition still rejected.** Facets declaring a `facets` field
  (composition of other facets) SHALL continue to hard-error with the
  existing message. Composition is a separate feature shape, not
  alpha-gated.
- **Rich Ink output for both commands.** Both `facet add` and
  `facet install` SHALL render through a shared `<InstallView />` Ink
  component — a `Resolving…` header, a per-facet bundle breakdown
  (single-facet runs only), per-adapter materialize progress, an
  aggregate `+ <name>@<version>` summary (multi-facet runs), and a
  final `<n> facet(s) installed [Xms]` line. When a single facet
  declares commands, the closing line SHALL surface
  `Now /<command> is available to your agents.`
- **Atomic manifest rollback.** `facet add` SHALL byte-snapshot
  `facets.json` before writing and restore it on any post-write
  failure. `runInstall` owns lockfile and materialize atomicity; if it
  throws, `facets.json` is restored and the project is left exactly as
  it was found.
- **Zero-adapter auto-flow.** When no adapters are installed AND the
  terminal is interactive, `facet add` SHALL launch the same picker
  `facet adapter install` uses, then continue. Non-TTY environments
  SHALL exit non-zero with the existing error.
- **No `--no-install` flag.** Mirroring npm, bun, and cargo, add and
  install are one operation. Users who want manifest-only edits MAY
  hand-edit `facets.json` and run `facet install`.

## Capabilities

### New Capabilities

None. This change reuses existing domains.

### Modified Capabilities

- `installation`: Adds requirements for the lockfile-driven install
  model, the cache layout and integrity protocol, the default-to-pinned
  storage policy, the asterisk-only range syntax, the manifest-rollback
  guarantee, the zero-adapter picker auto-flow, and the
  declared-but-not-materialized handling of MCP servers.
- `cli`: Promotes `add` from "manifest-edit only" to the combined
  flow. Replaces the existing source-grammar requirements with the
  npm-aligned grammar above. Adds the rich `<InstallView />` rendering
  for both `add` and `install`, the asterisk-only range parsing, the
  server-warning behavior, the integrity-mismatch error paths, and the
  re-add update line. Other CLI requirements (help, dispatch, exit
  codes, per-command flags) are unchanged.

## Non-Goals

- **The registry itself.** This change wires up stubbed registry calls
  with real seams; the registry server, API contract, hosting,
  publish/yank flows, and registry auth are out of scope.
- **Multi-registry support, registry mirrors, or registry-selection
  flags.** `facets.cafe` is sole.
- **`facet update`.** Re-resolving locked entries against ranges in
  `facets.json` is a separate command in a future proposal.
- **Cache management commands** (`facet cache clean`, prune, etc.).
  Future proposal; the cache SHALL be self-managing for now (writes on
  miss, never auto-evicts).
- **Full semver range syntax.** `^`, `~`, `>=`, `||`, `1.x` SHALL
  hard-error pointing users at the asterisk equivalents.
- **MCP server materialization** or auth flows.
- **Facet composition** (`facets` field).
- **A `--no-install` opt-out flag on `facet add`.**

## Impact

- **Affected commands**: `facet add` (new behavior, new source forms,
  new range syntax, rendering through Ink), `facet install` (refactored
  to call the shared `runInstall` core; output now rendered through Ink
  with content-equivalent format), `facet adapter install` (picker
  logic extracted into a reusable helper; behavior unchanged from a
  user's perspective).
- **Affected code**: `packages/cli/src/commands/add/` (rewrite
  `parse-source.ts`, new `add/index.ts` flow);
  `packages/cli/src/commands/install/` (new `run-install.ts`,
  `resolve-source.ts`, `resolve-registry-metadata.ts`,
  `download-facet-tarball.ts`, `install-view.tsx`; refactor
  `install/index.ts` to thin caller);
  `packages/cli/src/commands/adapter/` (new `pick-and-install.ts`).
- **New on-disk artifact**: `~/.facets/cache/` (overridable via
  `FACETS_CACHE_DIR`).
- **No new dependencies.** Ink, the install journal, the picker, and
  Bun's primitives are already in the CLI package.
- **Docs**: `docs/cli/add.md` filled; `docs/cli/install.md` updated to
  describe lockfile-driven semantics and that `facets.lock` is
  committed; `docs/architecture/lockfile.md` (new) SHOULD document the
  cache, integrity protocol, and trust model; `README.md` "Quick
  start" updated to drop the separate `facet install` step;
  `CHANGELOG.md` entries for each major change.
- **ADRs**: None. The OpenSpec change artifacts are the authoritative
  record for this change; Constitution Article III's ADR-filing
  expectation is explicitly waived.
- **Tests**: New coverage in `commands/add/__tests__/` and
  `commands/install/__tests__/` for: registry stub error,
  asterisk-version parsing (each form + each rejection), SCP-style URL
  acceptance, three-check integrity protocol (each check fires the
  right error), cache hit / cache miss, lockfile-vs-registry integrity
  mismatch, manifest rollback (build / materialize / lockfile failures),
  no-adapter TTY (picker mocked), no-adapter non-TTY, `git+`
  hard-reject, server-warning path, no-asset bundle path, re-add
  with version change, no-change re-add, multi-facet aggregate
  rendering, single-facet detail rendering.
- **Migration / breaking change**: `git+https://` and `git+ssh://`
  prefixes SHALL be hard-rejected; partners had no users yet so the
  break is cheap. `facet install` output rendering changes from plain
  stdout to Ink; content is preserved. The `parse-source` rejection of
  bare names is replaced by registry routing — strictly more permissive,
  not a break.
