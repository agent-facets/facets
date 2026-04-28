---
title: Changelog
description: What's new in Agent Facets
rss: true
---

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
  description: "facet add and facet install are now available. Use 'facet add github:owner/repo' (or git+https:// or file: specifiers) to register a facet in facets.json, then 'facet install' to materialize assets into every connected adapter. Supports lockfile diffing, rollback on failure, atomic concurrent-install locking, --dry-run, and --verbose. The CLI installer has moved to https://agentfacets.io/install — install on macOS and Linux with 'curl -fsSL https://agentfacets.io/install | bash', or on any platform with Node.js via 'npm install -g agent-facets'."
}}>
  ## facet add and facet install

  You can now add facets from external sources and install them into your AI coding tools end-to-end.

  **`facet add`** resolves a facet from GitHub, a Git URL, or a local path and writes it to your project's `facets.json`, preserving any hand-edited comments:

  ```sh
  facet add github:owner/repo
  facet add git+https://github.com/owner/repo.git
  facet add file:../local-facet
  ```

  **`facet install`** reads `facets.json`, builds each facet, and materializes its assets into every adapter you've connected. The pipeline is built for iteration:

  - **Lockfile diffing** — only changed assets are written on each run.
  - **Rollback on failure** — if something goes wrong mid-install, changes are reversed automatically.
  - **Concurrent safety** — an atomic install lock prevents two `facet install` runs from interfering with each other.
  - **`--dry-run`** — preview the install plan without touching disk.
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
