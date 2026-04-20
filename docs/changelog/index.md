---
title: Changelog
description: What's new in Agent Facets
---

<Update label="2026-04-20" description="Faster adapter installs" tags={["Update"]}>
  ## Prebuilt adapter fast path

  Adapter installs are now significantly faster. When a prebuilt bundle is available, the CLI uses it directly — no bundling step required. If the prebuilt bundle can't be loaded, the CLI falls back to rebuilding from source automatically.

  Build artifacts from the fallback path are now written to a temporary directory instead of your source tree, so local installs stay clean.

  You can also customize where adapters are stored by setting the [`FACETS_ADAPTERS_DIR`](/cli/env) environment variable. This overrides the default `~/.facets/adapters/` location for all adapter commands.
</Update>

<Update label="2026-04-17" description="Codex adapter" tags={["Update"]}>
  ## Codex adapter (early access)

  A third first-party adapter for [Codex](https://openai.com/index/introducing-codex/) is now available. You can install it with:

  ```sh
  facet adapter install codex
  ```

  Full install support (`facet install` asset materialization) is coming soon — Codex appears in the adapter picker but is not yet selectable for facet installation. See the [adapter install reference](/cli/adapters/install) for all built-in adapter names.
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

<Update label="2026-04-17" description="Adapter system" tags={["Feature"]}>
  ## Adapter SDK and first-party adapters

  Adapters are the bridge between facets and your AI coding tool. Each adapter knows where and how to write assets for a specific tool.

  The first supported adapters are **Claude Code** and **OpenCode**. When you run `facet install`, the CLI materializes your facet assets into the correct locations for each adapter you've installed.

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
