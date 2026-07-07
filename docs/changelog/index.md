---
title: Changelog
description: What's new in Agent Facets
rss: true
---

<Update label="2026-06-06" description="New facet remove command (aliased rm)" tags={["CLI", "New Feature"]} rss={{
  title: "New command: facet remove",
  description: "facet remove (aliased rm) takes one or more facets out of a project: it removes them from facets.json, deletes their assets from every connected adapter, and rewrites facets.lock without them, in a single command. It is the inverse of facet add and reuses the same install pipeline, so removal is transactional  -- any failure restores facets.json byte-for-byte. Removing multiple facets is all-or-nothing, and removing a facet that is not declared fails without changing anything."
}}>
  ## New command: `facet remove`

  `facet remove <facet> [more facets...]` is the inverse of `facet add`: it
  takes facets back out of a project. In one command it removes the named
  facets from `facets.json`, deletes their assets from every connected
  adapter, and rewrites `facets.lock` without them.

  ```bash
  # Remove a single facet.
  facet remove viper-plans

  # rm is an alias.
  facet rm viper-plans

  # Remove several at once.
  facet remove viper-plans rezi
  ```

  Removal reuses the same install pipeline as `facet add`, so it is
  **transactional**: any failure restores `facets.json` byte-for-byte and
  leaves the project unchanged. Removing multiple facets is all-or-nothing  --
  if any name is not declared in `facets.json`, nothing is removed. Every
  facet you don't name is left untouched.

  See the [`facet remove`](/cli/remove) reference for details.
</Update>

<Update label="2026-06-05" description="Bearer-token auth for the registry; new login/whoami/logout commands; FACET_REGISTRY_API_KEY removed; install now re-resolves a stale lockfile; new --frozen-lockfile flag" tags={["CLI", "Breaking", "New Feature", "Fix"]} rss={{
  title: "Registry auth moves to bearer tokens; new login/whoami/logout commands; install honors manifest edits",
  description: "The facet CLI now authenticates to the registry with a personal access token sent as a bearer credential, replacing the old FACET_REGISTRY_API_KEY API key. FACET_REGISTRY_API_KEY has been removed with no shim. Provide a token via the FACET_TOKEN environment variable or by running the new `facet login` command, which verifies the token and saves it to ~/.facet/credentials. Two more new commands: `facet whoami` prints the signed-in identity, and `facet logout` clears the saved credential. `facet publish` now also accepts an optional directory argument. Registry errors are now rendered using the registry's own message and suggested fix. Bug fix: editing a facet's version in facets.json now takes effect  -- facet install re-resolves a lockfile entry that no longer satisfies the manifest, and fails if the requested version does not exist, instead of silently keeping the old version. New flag: facet install --frozen-lockfile treats the lockfile as the source of truth and fails on any manifest/lockfile drift, for reproducible CI installs."
}}>
  ## Registry authentication is now bearer-token based

  **Breaking:** the `FACET_REGISTRY_API_KEY` environment variable has been
  **removed**  -- there is no fallback or deprecation shim. The CLI now sends an
  `Authorization: Bearer <token>` header, where the token is a personal access
  token (PAT) you mint in the web UI.

  Provide the token one of two ways:

  ```bash
  # 1. Environment variable (preferred for CI):
  export FACET_TOKEN=fct_pub_…
  facet publish

  # 2. Or sign in interactively  -- verifies the token and saves it to
  #    ~/.facet/credentials (mode 600):
  facet login
  ```

  When `FACET_TOKEN` is set it takes precedence over the saved file. Read-only
  commands like `facet search` and `facet add` send the token too when one is
  available (earning a higher rate-limit tier) and work anonymously otherwise.

  ## New commands: `login`, `whoami`, `logout`

  - **`facet login`**  -- guided sign-in. Paste a PAT; the CLI verifies it
    against the registry before saving it, so a typo or expired token fails
    fast instead of surfacing later at publish time. A browser sign-in option
    is shown as "coming soon".
  - **`facet whoami`**  -- prints the signed-in username, email, and tier, and
    notes when `FACET_TOKEN` is the active credential.
  - **`facet logout`**  -- removes the saved credentials file. It makes no
    server call; revoke PATs in the web UI. If `FACET_TOKEN` is still set, it
    tells you so.

  ## `facet publish` takes an optional directory

  `facet publish` now accepts a directory argument and defaults to the current
  directory, matching `facet build`, `facet edit`, and `facet create`:

  ```bash
  facet publish            # publish the facet in the current directory
  facet publish ./cowsay   # publish the facet in ./cowsay
  ```

  A first-time publish of a reserved or over-budget global facet may be queued
  for admin review  -- this is reported as a success, not an error.

  ## Registry errors render verbatim

  When the registry rejects a request, the CLI now shows the registry's own
  message and suggested fix rather than translating the error code through a
  local table. The registry is the single source of truth for what an error
  means  -- so error guidance stays accurate as the registry evolves, with no CLI
  release required.

  See the [Publish Flow](/specification/publish) spec for the full
  authentication model.

  ## Editing a version in `facets.json` now takes effect

  **Fix:** `facets.json` is the source of truth, but `facet install` was
  ignoring an edited version when the lockfile still pinned the old one. If you
  bumped a facet to a version that didn't exist, install "succeeded" and wrote a
  self-contradictory lockfile entry instead of failing.

  Now `facet install` compares each lockfile entry against its manifest
  specifier. A locked version that no longer satisfies the manifest is treated
  as stale and re-resolved:

  ```bash
  # facets.json edited: cowsay 0.1.1 → 0.1.2
  facet install          # fetches 0.1.2, updates the lockfile (was 0.1.1 → 0.1.2)

  # facets.json edited to a version that doesn't exist
  facet install          # fails: version not found; project left unchanged
  ```

  A wildcard the lock still satisfies (manifest `1.*`, lock `1.2.3`) is
  unaffected  -- it stays pinned and reproducible. See [`facet install`](/cli/install#lockfile-semantics).

  ## New: `facet install --frozen-lockfile`

  For reproducible CI installs, `--frozen-lockfile` makes the lockfile the
  source of truth: install never re-resolves or writes the lockfile, and fails
  if the lockfile is missing, omits a manifest facet, or has drifted out of sync
  with `facets.json`.

  ```bash
  facet install --frozen-lockfile   # passes only if facets.json and facets.lock agree
  ```

  This mirrors `--frozen-lockfile` from `npm` and `bun`. See [the flag
  reference](/cli/install#frozen-lockfile).
</Update>

<Update label="2026-05-14" description="Consolidate everything under FACET_DIR; new FACET_BIN_OVERRIDE; lock moves out of project root" tags={["CLI", "Breaking"]} rss={{
  title: "Consolidate everything under FACET_DIR and move the install lock out of the project root",
  description: "One environment variable now controls everything the CLI writes to disk: FACET_DIR (default ~/.facet). The cache, installed adapters, install advisory locks, and the curl-installed binary all live under it. FACET_BIN_OVERRIDE replaces FACET_BIN_PATH as the launcher's binary override (and continues to refuse self-update when set, because overriding means you've taken control). The install advisory lock moves from <projectRoot>/.facets/.install.lock to $FACET_DIR/locks/<basename>-<hash>.lock  -- facet install no longer writes anything to your project root. Removed env vars (no aliases, hard rename): FACETS_CACHE_DIR, FACETS_ADAPTERS_DIR, FACET_CACHE_DIR, FACET_ADAPTERS_DIR, FACET_INSTALL_DIR, FACET_BIN_PATH. No automatic migration of existing ~/.facets/ data."
}}>
  ## One directory, one override

  The facet CLI used to spread its state across four near-identical
  locations and five separate environment variables. State for the
  cache, installed adapters, the curl-installed binary, and parallel-
  install coordination all lived in different places with different
  overrides. This release collapses everything into a single root: one
  directory, one environment variable.

  ### The new shape

  Everything the CLI writes to disk now lives under `$FACET_DIR`:

  ```
  $FACET_DIR/
    ├── bin/        # curl-installed binary
    ├── cache/      # content-addressed cache for fetched facets
    ├── adapters/   # installed adapter bundles
    └── locks/      # install advisory locks (one file per project)
  ```

  The default for `$FACET_DIR` is `~/.facet/`. Setting `FACET_DIR` IS
  the override  -- there is no separate variable per subsystem. Curl
  installs put the binary at `$FACET_DIR/bin/facet`; `facet add` and
  `facet install` resolve cache and adapters relative to the same root.

  ### What changed

  | Before                                  | After                                     |
  | --------------------------------------- | ----------------------------------------- |
  | `FACETS_CACHE_DIR`                      | `FACET_DIR` (cache is `$FACET_DIR/cache`) |
  | `FACETS_ADAPTERS_DIR`                   | `FACET_DIR` (adapters at `$FACET_DIR/adapters`) |
  | `FACET_INSTALL_DIR`                     | `FACET_DIR` (curl bin at `$FACET_DIR/bin`)|
  | `FACET_BIN_PATH`                        | `FACET_BIN_OVERRIDE`                      |
  | `<projectRoot>/.facets/.install.lock`   | `$FACET_DIR/locks/<basename>-<hash>.lock` |
  | `~/.facets/cache/<name>@<version>/`     | `$FACET_DIR/cache/<name>@<version>/`      |
  | `~/.facets/adapters/<name>/`            | `$FACET_DIR/adapters/<name>/`             |

  `FACET_CLI_REGISTRY` (npm registry URL override) and `FACET_VERSION`
  (used by `install.sh`) are unchanged.

  ### `FACET_BIN_OVERRIDE`, by name

  The launcher's binary override gets a new name that carries its own
  semantics: `FACET_BIN_OVERRIDE`. Setting it means you've taken control
  of which binary the launcher executes. `facet self-update` continues
  to refuse while it's set, because if you've overridden the binary
  path, self-update has no business writing over whatever you pointed
  it at. The refusal is coupled to the override on purpose.

  Unset `FACET_BIN_OVERRIDE` to re-enable self-update for a real install.

  ### Project root: clean

  The install advisory lock no longer touches your project root.
  Previously, `facet install` materialized `.facets/.install.lock` next
  to `facets.json`  -- a project-local directory that wasn't tracked
  anywhere and could be left behind on crashes. The lock now lives at
  `$FACET_DIR/locks/<basename>-<sha256(realpath)[:16]>.lock`, keyed by
  the project's canonical path so two checkouts of the same repo at
  different paths (git worktrees, Conductor workspaces) get distinct
  locks.

  No `.facet.lock` file, no `.facets/` directory, no untracked entry
  next to your `facets.json`. The project root stays as clean as
  `facets.json` itself.

  **Breaking:** No automatic migration. The new code reads `$FACET_DIR`
  only  -- existing cached payloads and adapters at `~/.facets/` are not
  detected, copied, or warned about. Old env vars (`FACETS_CACHE_DIR`,
  `FACETS_ADAPTERS_DIR`, `FACET_CACHE_DIR`, `FACET_ADAPTERS_DIR`,
  `FACET_INSTALL_DIR`, `FACET_BIN_PATH`) are silently ignored  -- anyone
  who had them set in shell rc files or CI configs must rename to
  `FACET_DIR` / `FACET_BIN_OVERRIDE` or the values stop taking effect.
  Existing `~/.facets/` data can be deleted at any time; the new code
  will rebuild cache and adapters on first use.

  See the [environment variables](/cli/env) reference and the
  [`facet install`](/cli/install) page for the updated paths.
</Update>

<Update label="2026-05-03" description="@agent-facets/core split into protocol (public, Node-native) and engine (private, Bun-native)" tags={["CLI", "Breaking", "Improvement"]} rss={{
  title: "Package split: @agent-facets/core → @agent-facets/protocol + @agent-facets/engine",
  description: "@agent-facets/core has been split into two packages. @agent-facets/protocol is the new public, Node-native package containing the facet artifact specification: schemas, validators, integrity verification, deterministic archive format, hash algorithm, and version-spec grammar. @agent-facets/engine is the Bun-native CLI machinery, now private to the monorepo. The legacy @agent-facets/core package is no longer published; existing pins to v0.9.1 continue to resolve. CLI behavior is unchanged."
}}>
  ## Three layers, honestly named

  `@agent-facets/core` was always two things: the **facet artifact specification** (schemas, integrity rules, deterministic archive format, hash algorithm) and the **Bun-native CLI implementation** of that specification (subprocess-driven adapter bundling, registry HTTP client, install pipeline, scaffold, edit, self-update). The first set is portable Node-runnable data + cryptography that any third party  -- a registry server, a future alternative CLI, an offline `.facet` linter  -- needs to honor. The second is intrinsically Bun-native and runs only on a developer's machine.

  Splitting them produces three honest layers:

  - **`@agent-facets/protocol`** (NEW, public, Node-native, Node 22+)  -- the TypeScript reference implementation of the facet artifact specification. Schemas, bytes-validators, integrity verification, content hashing, deterministic tar layout, version-spec grammar, front-matter encoding, build validators. Pure data + cryptography. No subprocesses, no network, no developer-machine state.
  - **`@agent-facets/engine`** (RENAMED from `@agent-facets/core`, made private)  -- the Bun-native CLI machinery. Install pipeline, registry HTTP client, adapter machinery, source resolvers, manifest mutations, cache, scaffold, edit, self-update, build pipeline orchestrator, gzip compression, path-based loaders. Internal to the monorepo; never published.
  - **`agent-facets`** (the CLI binary, unchanged)  -- argv parsing, Ink TUI, error formatting, exit codes.

  See `docs/contributing/architecture` for the full layer description and the design rationale for keeping the registry HTTP API outside the protocol.

  **Breaking:** `@agent-facets/core` is no longer published. The package is frozen at v0.9.1 on npm; existing pins continue to resolve, but there will be no further versions. New consumers (registry servers, third-party tooling) MUST use `@agent-facets/protocol`. There is no deprecation message on the legacy package  -- closed-alpha, no known external consumers.

  **No CLI behavior change.** Every `@agent-facets/core` import in the CLI was redirected to either `@agent-facets/protocol` (data primitives) or `@agent-facets/engine` (orchestrators). User-visible commands, flags, and output are unchanged.
</Update>

<Update label="2026-05-01" description="facet add now installs in one step; new source grammar; lockfile-driven install" tags={["CLI", "New Feature", "Breaking"]} rss={{
  title: "facet add now installs in one step; new source grammar; lockfile-driven install",
  description: "facet add now resolves, fetches, verifies, and installs a facet in a single command  -- no separate facet install step needed. New source grammar accepts registry names, github:owner/repo shorthand, plain https://...git URLs, SCP-style git@host:owner/repo, and local paths. Breaking: git+https:// and git+ssh:// prefixes are rejected (drop the git+); caret/tilde/comparator version ranges are rejected (use 1.* or 1.2.3); facet install no longer accepts --dry-run or positional arguments. Adds: lockfile bootstrap on first install, lockfile-driven reproducibility, three-check integrity protocol for registry sources, ~/.facets/cache/ with FACETS_CACHE_DIR override, repaired outcome when adapter files have drifted, server warnings, and adapter picker auto-launch when a project has no adapters."
}}>
  ## facet add and facet install converge

  `facet add` now does everything end-to-end. Resolve, fetch, verify integrity, materialize into adapters, write the lockfile  -- all in a single command. There is no separate `facet install` step after `facet add`.

  ```sh
  # The old two-step flow:
  facet add github:owner/repo
  facet install            # <-- no longer needed

  # The new one-step flow:
  facet add github:owner/repo
  ```

  `facet install` is still there, and it's the right command after a fresh `git clone` or after pulling teammate changes that updated `facets.json`. It honors any pinned versions in `facets.lock` verbatim and only resolves entries that don't have a lockfile entry yet  -- making installs reproducible across machines without a separate `facet update` command.

  If a project has no adapters installed, both `facet add` and `facet install` now auto-launch the adapter picker on a TTY, so first-run experience is a single command from a cold start.

  ## New source grammar

  `facet add` accepts a richer set of sources, aligned with what npm and bun users already expect:

  ```sh
  facet add viper-plans              # registry name (resolved version pinned)
  facet add viper-plans@1.2.3        # exact version
  facet add viper-plans@1.*          # major-pinned wildcard
  facet add viper-plans@latest       # alias for the bare-name form
  facet add github:owner/repo#main   # GitHub shorthand with a ref
  facet add https://example.com/repo.git#v1.0.0
  facet add git@github.com:owner/repo.git#main
  facet add ./local-facets/my-plans  # local path inside the project
  facet add a b c                    # multi-source: install several at once
  ```

  Bare names default to the resolved exact version when written back to `facets.json`  -- so `facet add viper-plans` produces `viper-plans@1.2.3` in the manifest, the same way `npm install` and `bun add` pin lockable defaults.

  ## Lockfile-driven, with bootstrap

  `facets.lock` is now the single source of truth for what gets installed:

  - When a lockfile entry exists, that exact version is fetched. The manifest's range is not re-resolved.
  - When a lockfile entry doesn't exist (first run, or a freshly-added manifest entry), the manifest specifier is resolved fresh.
  - When `facets.lock` doesn't exist yet, `facet install` bootstraps it  -- the same way `bun install` creates `bun.lock`.

  ## Three-check integrity protocol

  Every fetched facet is verified before any asset is written:

  - **Registry sources** run three independent checks: cache vs. registry metadata, archive manifest vs. registry metadata, computed content vs. archive manifest. Each defends against a distinct adversary.
  - **Git sources** run a single check: computed content vs. lockfile integrity. Defends against tag-move attacks.
  - **Local sources** are trust-by-path.

  Any mismatch is a hard security error. The install aborts before any asset is written; the project is exactly as it was before.

  ## Cache

  Resolved facet content is cached at `~/.facets/cache/<name>@<version>/`. Subsequent installs of the same identity hit the cache instead of the network. Override with the `FACETS_CACHE_DIR` environment variable.

  ## Repaired outcome

  If you delete a materialized asset by hand and re-run `facet install`, the affected facet now reports as `repaired` in the summary  -- the adapter file is restored without bumping the version. This makes self-heal explicit instead of silent.

  ## Breaking changes

  - **`git+` prefix is removed.** Use plain `https://...git` or `git@host:owner/repo` instead. The new grammar accepts everything `git+` did, just without the prefix.
  - **Caret, tilde, and comparator version ranges are rejected.** Use `1.*` for major-pinned, `1.2.*` for minor-pinned, `*` or `latest` for unpinned, or `1.2.3` for exact. The `@latest` alias and bare-name form both produce the same result as `*`.
  - **`facet install --dry-run` is gone.** No replacement; `facet install` always commits.
  - **`facet install` rejects positional arguments.** To add a new facet to the project, use `facet add`.

  See the [facet add](/cli/add) and [facet install](/cli/install) CLI reference for full details.
</Update>

<Update label="2026-04-28" description="Publish pipeline fixed across all packages" tags={["CLI", "Fix"]} rss={{
  title: "Publish pipeline fixed across all packages",
  description: "Releases of agent-facets, @agent-facets/core, @agent-facets/adapter, and the first-party adapters (Claude Code, OpenCode, Codex) had been failing intermittently. The publish pipeline is now fixed and all packages have been republished. Reinstall with: npm install -g agent-facets, or curl -fsSL https://agentfacets.io/install | bash."
}}>
  ## Publish pipeline fixed across all packages

  Recent releases of `agent-facets` and the supporting packages had been failing or shipping inconsistently due to issues in the publish pipeline. All affected packages have been republished from a known-good state:

  - `agent-facets`  -- the CLI
  - `@agent-facets/core` and `@agent-facets/adapter`  -- authoring and adapter SDKs
  - `@agent-facets/adapter-claude-code`, `@agent-facets/adapter-opencode`, and `@agent-facets/adapter-codex`  -- first-party adapters

  If you installed or upgraded the CLI in the last week and ran into install or runtime errors, reinstall:

  ```sh
  curl -fsSL https://agentfacets.io/install | bash
  ```

  Or, on any platform with Node.js:

  ```sh
  npm install -g agent-facets
  ```

  No usage changes  -- `facet add`, `facet install`, and the [adapter commands](/cli/adapters/install) all behave the same as before.
</Update>

<Update label="2026-04-22" description="Mobile-responsive landing page" tags={["Improvement"]} rss={{
  title: "Mobile-responsive landing page",
  description: "The Agent Facets landing page at agentfacets.io is now fully responsive on phones and tablets. Navigation collapses into a slide-down mobile menu, the CLI demo adapts for smaller screens, and all sections stack cleanly on narrow viewports."
}}>
  ## Mobile-responsive landing page

  The [agentfacets.io](https://agentfacets.io) landing page is now fully responsive. If you previously visited on a phone or tablet, the experience was broken  -- the scroll-linked demo, navigation, and layout all assumed a desktop viewport. That's fixed.

  Here's what changed:

  - **Mobile navigation**  -- the nav bar collapses into a slide-down menu on screens ≤ 1024 px wide, with all links accessible from a single tap.
  - **Adapted CLI demo**  -- the interactive terminal demo skips the widest step on small screens so it fits without horizontal scrolling.
  - **Stacked sections**  -- the explainer, hero, and footer all reflow into a clean single-column layout on narrow viewports.
  - **Registry CTA**  -- on mobile, the install command is replaced with a link to [agentfacets.io](https://agentfacets.io) so you can browse facets without needing a terminal.

  The desktop layout is unchanged.
</Update>

<Update label="2026-04-21" description="Landing page and new docs URL" tags={["Improvement"]} rss={{
  title: "Landing page and new docs URL",
  description: "Agent Facets has a new landing page at https://agentfacets.io with a live CLI demo. Install the CLI with: curl -fsSL https://agentfacets.io/install | bash. Documentation has moved to https://docs.agentfacets.io  -- update any bookmarks."
}}>
  ## agentfacets.io landing page

  The Agent Facets website now has a proper landing page at [agentfacets.io](https://agentfacets.io). It walks you through what facets are, shows a live CLI demo, and makes it easy to get started with a single install command:

  ```sh
  curl -fsSL https://agentfacets.io/install | bash
  ```

  ## New docs URL

  Documentation has moved to its own subdomain at [docs.agentfacets.io](https://docs.agentfacets.io). The main domain at `agentfacets.io` now serves the landing page, and the CLI installer lives at `agentfacets.io/install`. Existing docs links have been preserved  -- you'll just land on the new URL. Update any bookmarks accordingly.
</Update>

<Update label="2026-04-20" description="Install pipeline and new install URL" tags={["CLI", "New Feature"]} rss={{
  title: "Install pipeline and new install URL",
  description: "facet add and facet install are now available. Use 'facet add github:owner/repo' (or an https:// git URL, or a local path) to register a facet in facets.json, then 'facet install' to materialize assets into every connected adapter. Supports lockfile diffing, rollback on failure, atomic concurrent-install locking, and --verbose. The CLI installer has moved to https://agentfacets.io/install  -- install on macOS and Linux with 'curl -fsSL https://agentfacets.io/install | bash', or on any platform with Node.js via 'npm install -g agent-facets'."
}}>
  ## facet add and facet install

  You can now add facets from external sources and install them into your AI coding tools end-to-end.

  **`facet add`** resolves a facet from GitHub, a Git URL, or a local path and writes it to your project's `facets.json`, preserving any hand-edited comments:

  ```sh
  facet add github:owner/repo
  facet add https://github.com/owner/repo.git
  facet add ./local-facet
  ```

  **`facet install`** reads `facets.json`, builds each facet, and materializes its assets into every adapter you've connected. The pipeline is built for iteration:

  - **Lockfile diffing**  -- only changed assets are written on each run.
  - **Rollback on failure**  -- if something goes wrong mid-install, changes are reversed automatically.
  - **Concurrent safety**  -- an atomic install lock prevents two `facet install` runs from interfering with each other.
  - **`--verbose`**  -- full pipeline trace for debugging.

  See the [facet add](/cli/add) and [facet install](/cli/install) CLI reference for details.

  ## New install URL

  The CLI installer has moved to its own home at `agentfacets.io/install`. If you previously bookmarked the install URL, update it to:

  ```sh
  curl -fsSL https://agentfacets.io/install | bash
  ```

  This works on macOS and Linux. For Windows or any platform with Node.js, you can install via npm instead:

  ```sh
  npm install -g agent-facets
  ```

  The [download link](/index) on the docs site has been updated automatically.
</Update>

<Update label="2026-04-18" description="Faster adapter installs" tags={["CLI", "Improvement"]}>
  ## Self-contained adapter bundles

  Adapters now ship as fully self-contained bundles with all dependencies inlined. When you run `facet adapter install`, the CLI uses a prebuilt fast path that skips the build step entirely  -- falling back to a full rebuild only if the prebuilt bundle is missing or incompatible.

  This also means adapter installs no longer leave build artifacts in your source tree.

  See the [environment variables](/cli/env) reference for configuring the adapter install location with `FACETS_ADAPTERS_DIR`.
</Update>

<Update label="2026-04-17" description="Adapter system with Claude Code, OpenCode, and Codex" tags={["CLI", "New Feature"]} rss={{
  title: "Adapter system with Claude Code, OpenCode, and Codex",
  description: "Adapters are the bridge between facets and your AI coding tool. First-party adapters ship for Claude Code, OpenCode, and Codex (early access  -- installable but asset materialization is coming soon). Manage adapters with 'facet adapter install', 'facet adapter list', and 'facet adapter remove <name>'. Third-party adapters install via npm, Git URL, or local path. See /cli/adapters/install for built-in adapter names."
}}>
  ## Adapter SDK and first-party adapters

  Adapters are the bridge between facets and your AI coding tool  -- each adapter knows where and how to write assets for a specific tool. The first three first-party adapters ship today:

  - **Claude Code**
  - **OpenCode**
  - **Codex** (early access  -- installable, but asset materialization via `facet install` is coming soon)

  When you run `facet install`, the CLI writes your facet assets into the correct locations for every adapter you've installed. Third-party adapters use the same installation and loading mechanism as first-party ones  -- install via npm, Git URL, or local path.

  Manage adapters with:

  ```sh
  facet adapter install
  facet adapter list
  facet adapter remove <name>
  ```

  If no adapters are installed when you run `facet install`, an interactive picker appears so you can select which AI tools to connect.

  See the [adapter CLI reference](/cli/adapters/install) for full usage, including all built-in adapter names.
</Update>

<Update label="2026-04-10" description="Self-contained archives" tags={["CLI", "Improvement"]}>
  ## Self-contained .facet archives

  The `.facet` build output is now a single self-contained archive. The build manifest is embedded inside the archive rather than shipped as a separate file, making distribution simpler. You can extract the manifest for debugging with `--emit-manifest` during build.

  See the [facet build](/cli/authoring/build) CLI reference.
</Update>
