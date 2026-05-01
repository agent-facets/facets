---
title: Changelog
description: What's new in Agent Facets
rss: true
---

<Update label="2026-05-01" description="facet add now installs in one step; new source grammar; lockfile-driven install" tags={["CLI", "New Feature", "Breaking"]} rss={{
  title: "facet add now installs in one step; new source grammar; lockfile-driven install",
  description: "facet add now resolves, fetches, verifies, and installs a facet in a single command — no separate facet install step needed. New source grammar accepts registry names, github:owner/repo shorthand, plain https://...git URLs, SCP-style git@host:owner/repo, and local paths. Breaking: git+https:// and git+ssh:// prefixes are rejected (drop the git+); caret/tilde/comparator version ranges are rejected (use 1.* or 1.2.3); facet install no longer accepts --dry-run or positional arguments. Adds: lockfile bootstrap on first install, lockfile-driven reproducibility, three-check integrity protocol for registry sources, ~/.facets/cache/ with FACETS_CACHE_DIR override, repaired outcome when adapter files have drifted, server warnings, and adapter picker auto-launch when a project has no adapters."
}}>
  ## facet add and facet install converge

  `facet add` now does everything end-to-end. Resolve, fetch, verify integrity, materialize into adapters, write the lockfile — all in a single command. There is no separate `facet install` step after `facet add`.

  ```sh
  # The old two-step flow:
  facet add github:owner/repo
  facet install            # <-- no longer needed

  # The new one-step flow:
  facet add github:owner/repo
  ```

  `facet install` is still there, and it's the right command after a fresh `git clone` or after pulling teammate changes that updated `facets.json`. It honors any pinned versions in `facets.lock` verbatim and only resolves entries that don't have a lockfile entry yet — making installs reproducible across machines without a separate `facet update` command.

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

  Bare names default to the resolved exact version when written back to `facets.json` — so `facet add viper-plans` produces `viper-plans@1.2.3` in the manifest, the same way `npm install` and `bun add` pin lockable defaults.

  ## Lockfile-driven, with bootstrap

  `facets.lock` is now the single source of truth for what gets installed:

  - When a lockfile entry exists, that exact version is fetched. The manifest's range is not re-resolved.
  - When a lockfile entry doesn't exist (first run, or a freshly-added manifest entry), the manifest specifier is resolved fresh.
  - When `facets.lock` doesn't exist yet, `facet install` bootstraps it — the same way `bun install` creates `bun.lock`.

  ## Three-check integrity protocol

  Every fetched facet is verified before any asset is written:

  - **Registry sources** run three independent checks: cache vs. registry metadata, archive manifest vs. registry metadata, computed content vs. archive manifest. Each defends against a distinct adversary.
  - **Git sources** run a single check: computed content vs. lockfile integrity. Defends against tag-move attacks.
  - **Local sources** are trust-by-path.

  Any mismatch is a hard security error. The install aborts before any asset is written; the project is exactly as it was before.

  ## Cache

  Resolved facet content is cached at `~/.facets/cache/<name>@<version>/`. Subsequent installs of the same identity hit the cache instead of the network. Override with the `FACETS_CACHE_DIR` environment variable.

  ## Repaired outcome

  If you delete a materialized asset by hand and re-run `facet install`, the affected facet now reports as `repaired` in the summary — the adapter file is restored without bumping the version. This makes self-heal explicit instead of silent.

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

  - `agent-facets` — the CLI
  - `@agent-facets/core` and `@agent-facets/adapter` — authoring and adapter SDKs
  - `@agent-facets/adapter-claude-code`, `@agent-facets/adapter-opencode`, and `@agent-facets/adapter-codex` — first-party adapters

  If you installed or upgraded the CLI in the last week and ran into install or runtime errors, reinstall:

  ```sh
  curl -fsSL https://agentfacets.io/install | bash
  ```

  Or, on any platform with Node.js:

  ```sh
  npm install -g agent-facets
  ```

  No usage changes — `facet add`, `facet install`, and the [adapter commands](/cli/adapters/install) all behave the same as before.
</Update>

<Update label="2026-04-22" description="Mobile-responsive landing page" tags={["Improvement"]} rss={{
  title: "Mobile-responsive landing page",
  description: "The Agent Facets landing page at agentfacets.io is now fully responsive on phones and tablets. Navigation collapses into a slide-down mobile menu, the CLI demo adapts for smaller screens, and all sections stack cleanly on narrow viewports."
}}>
  ## Mobile-responsive landing page

  The [agentfacets.io](https://agentfacets.io) landing page is now fully responsive. If you previously visited on a phone or tablet, the experience was broken — the scroll-linked demo, navigation, and layout all assumed a desktop viewport. That's fixed.

  Here's what changed:

  - **Mobile navigation** — the nav bar collapses into a slide-down menu on screens ≤ 1024 px wide, with all links accessible from a single tap.
  - **Adapted CLI demo** — the interactive terminal demo skips the widest step on small screens so it fits without horizontal scrolling.
  - **Stacked sections** — the explainer, hero, and footer all reflow into a clean single-column layout on narrow viewports.
  - **Registry CTA** — on mobile, the install command is replaced with a link to [facet.cafe](https://facet.cafe) so you can browse facets without needing a terminal.

  The desktop layout is unchanged.
</Update>

<Update label="2026-04-21" description="Landing page and new docs URL" tags={["Improvement"]} rss={{
  title: "Landing page and new docs URL",
  description: "Agent Facets has a new landing page at https://agentfacets.io with a live CLI demo. Install the CLI with: curl -fsSL https://agentfacets.io/install | bash. Documentation has moved to https://docs.agentfacets.io — update any bookmarks."
}}>
  ## agentfacets.io landing page

  The Agent Facets website now has a proper landing page at [agentfacets.io](https://agentfacets.io). It walks you through what facets are, shows a live CLI demo, and makes it easy to get started with a single install command:

  ```sh
  curl -fsSL https://agentfacets.io/install | bash
  ```

  ## New docs URL

  Documentation has moved to its own subdomain at [docs.agentfacets.io](https://docs.agentfacets.io). The main domain at `agentfacets.io` now serves the landing page, and the CLI installer lives at `agentfacets.io/install`. Existing docs links have been preserved — you'll just land on the new URL. Update any bookmarks accordingly.
</Update>

<Update label="2026-04-20" description="Install pipeline and new install URL" tags={["CLI", "New Feature"]} rss={{
  title: "Install pipeline and new install URL",
  description: "facet add and facet install are now available. Use 'facet add github:owner/repo' (or an https:// git URL, or a local path) to register a facet in facets.json, then 'facet install' to materialize assets into every connected adapter. Supports lockfile diffing, rollback on failure, atomic concurrent-install locking, and --verbose. The CLI installer has moved to https://agentfacets.io/install — install on macOS and Linux with 'curl -fsSL https://agentfacets.io/install | bash', or on any platform with Node.js via 'npm install -g agent-facets'."
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

  - **Lockfile diffing** — only changed assets are written on each run.
  - **Rollback on failure** — if something goes wrong mid-install, changes are reversed automatically.
  - **Concurrent safety** — an atomic install lock prevents two `facet install` runs from interfering with each other.
  - **`--verbose`** — full pipeline trace for debugging.

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

  Adapters now ship as fully self-contained bundles with all dependencies inlined. When you run `facet adapter install`, the CLI uses a prebuilt fast path that skips the build step entirely — falling back to a full rebuild only if the prebuilt bundle is missing or incompatible.

  This also means adapter installs no longer leave build artifacts in your source tree.

  See the [environment variables](/cli/env) reference for configuring the adapter install location with `FACETS_ADAPTERS_DIR`.
</Update>

<Update label="2026-04-17" description="Adapter system with Claude Code, OpenCode, and Codex" tags={["CLI", "New Feature"]} rss={{
  title: "Adapter system with Claude Code, OpenCode, and Codex",
  description: "Adapters are the bridge between facets and your AI coding tool. First-party adapters ship for Claude Code, OpenCode, and Codex (early access — installable but asset materialization is coming soon). Manage adapters with 'facet adapter install', 'facet adapter list', and 'facet adapter remove <name>'. Third-party adapters install via npm, Git URL, or local path. See /cli/adapters/install for built-in adapter names."
}}>
  ## Adapter SDK and first-party adapters

  Adapters are the bridge between facets and your AI coding tool — each adapter knows where and how to write assets for a specific tool. The first three first-party adapters ship today:

  - **Claude Code**
  - **OpenCode**
  - **Codex** (early access — installable, but asset materialization via `facet install` is coming soon)

  When you run `facet install`, the CLI writes your facet assets into the correct locations for every adapter you've installed. Third-party adapters use the same installation and loading mechanism as first-party ones — install via npm, Git URL, or local path.

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
