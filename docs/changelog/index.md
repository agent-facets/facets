---
title: Changelog
description: What's new in Agent Facets
---

<Update label="2026-04-21" description="New landing page" tags={["Feature"]}>
  ## agentfacets.io landing page

  The Agent Facets website now has a proper landing page at [agentfacets.io](https://agentfacets.io). It walks you through what facets are, shows a live CLI demo, and makes it easy to get started with a single install command.
</Update>

<Update label="2026-04-21" description="Out of closed alpha" tags={["Update"]}>
  ## Agent Facets is now open

  The project has moved out of closed alpha. You no longer need an invite or partner access to use Agent Facets — just [install the CLI](/cli) and start adding facets to your projects.
</Update>

<Update label="2026-04-21" description="Docs moved to docs.agentfacets.io" tags={["Update"]}>
  ## New docs URL

  Documentation now lives at [docs.agentfacets.io](https://docs.agentfacets.io). The main domain at `agentfacets.io` serves the landing page, and the CLI installer is available at `agentfacets.io/install`. Update any bookmarks accordingly.
</Update>

<Update label="2026-04-20" description="New install URL and cross-platform support" tags={["Update"]}>
  ## New install URL

  The CLI installer has moved to a new home at `agentfacets.io/install`. If you previously bookmarked the install URL, update it to:

  ```sh
  curl -fsSL https://agentfacets.io/install | bash
  ```

  This method works on macOS and Linux. For Windows or any platform with Node.js, you can install via npm:

  ```sh
  npm install -g agent-facets
  ```

  The [download link](/index) on the docs site has been updated automatically.
</Update>

<Update label="2026-04-20" description="Alpha install pipeline" tags={["Feature"]}>
  ## facet add and facet install

  You can now add facets from external sources and install them into your AI coding tools.

  **`facet add`** resolves facets from GitHub repositories, Git URLs, and local file paths. It updates your project's `facets.json` while preserving any hand-edited comments.

  ```sh
  facet add github:owner/repo
  facet add git+https://github.com/owner/repo.git
  facet add file:../local-facet
  ```

  **`facet install`** reads your `facets.json`, builds each facet, and materializes assets into every configured adapter. It includes:

  - **Lockfile diffing** — only changed assets are written
  - **Best-effort rollback** — if something fails mid-install, changes are reversed
  - **Concurrent install protection** — an atomic lock prevents two installs from running at once
  - **`--dry-run`** — preview what will change without touching disk
  - **`--verbose`** — detailed pipeline output for debugging

  See the [facet add](/cli/add) and [facet install](/cli/install) CLI reference for details.
</Update>

<Update label="2026-04-18" description="Faster adapter installs" tags={["Update"]}>
  ## Self-contained adapter bundles

  Adapters now ship as fully self-contained bundles with all dependencies inlined. When you run `facet adapter install`, the CLI uses a prebuilt fast path that skips the build step entirely — falling back to a full rebuild only if needed.

  This also means adapter installs no longer leave build artifacts in your source tree.

  See the [environment variables](/cli/env) reference for configuring the adapter install location with `FACETS_ADAPTERS_DIR`.
</Update>

<Update label="2026-04-17" description="Codex adapter" tags={["Update"]}>
  ## Codex adapter (early access)

  A third first-party adapter for [Codex](https://openai.com/index/introducing-codex/) is now available. You can install it with:

  ```sh
  facet adapter install codex
  ```

  Full install support (`facet install` asset materialization) is coming soon — Codex appears in the adapter picker but is not yet selectable for facet installation. See the [adapter install reference](/cli/adapters/install) for all built-in adapter names.
</Update>

<Update label="2026-04-17" description="Adapter system" tags={["Feature"]}>
  ## Adapter SDK and first-party adapters

  Adapters are the bridge between facets and your AI coding tool. Each adapter knows where and how to write assets for a specific tool.

  The first supported adapters are **Claude Code**, **OpenCode**, and **Codex**. When you run `facet install`, the CLI materializes your facet assets into the correct locations for each adapter you've installed.

  You can manage adapters with:

  ```sh
  facet adapter install
  facet adapter list
  facet adapter remove <name>
  ```

  Third-party adapters use the same installation and loading mechanism as first-party ones — install via npm, Git URL, or local path.

  See the [adapter CLI reference](/cli/adapters/install) for more.
</Update>

<Update label="2026-04-10" description="Self-contained archives" tags={["Update"]}>
  ## Self-contained .facet archives

  The `.facet` build output is now a single self-contained archive. The build manifest is embedded inside the archive rather than shipped as a separate file, making distribution simpler. You can extract the manifest for debugging with `--emit-manifest` during build.

  See the [facet build](/cli/authoring/build) CLI reference.
</Update>
