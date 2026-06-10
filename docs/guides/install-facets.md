---
title: Install Facets in Your Project
description: Search, add, and manage facets in your AI coding projects
---

This guide covers installing facets into a project: setting up an adapter, searching the registry, adding facets, and managing the project manifest and lockfile.

## Install an adapter

An adapter is the bridge between facets and your AI coding tool. It tells the `facet` CLI where to place assets on disk so your tool can find them. You need at least one adapter installed before you can add facets.

```sh
facet adapter install
```
<sub>[CLI reference ↗](/cli/adapters/install)</sub>

Without a specifier, this launches an interactive picker listing the first-party adapters:

| Name          | Package                              | Tool        |
| ------------- | ------------------------------------ | ----------- |
| `opencode`    | `@agent-facets/adapter-opencode`     | OpenCode    |
| `claude-code` | `@agent-facets/adapter-claude-code`  | Claude Code |
| `codex`       | `@agent-facets/adapter-codex`        | Codex       |

You can also install by name directly:

```sh
facet adapter install opencode
```

The adapter is downloaded, bundled into a self-contained `adapter.js`, and placed in `~/.facet/adapters/<name>/`. See [`facet adapter install`](/cli/adapters/install) for all specifier formats (npm packages, git URLs, local paths).

## Search the registry

```sh
facet search <term>
```
<sub>[CLI reference ↗](/cli/search)</sub>

Results show the facet name, latest version, asset counts, and the install command:

```
viper-plans   v1.2.0
  2 skills, 1 agent, 1 command
  -> facet add viper-plans

rezi   v0.5.0
  3 skills
  -> facet add rezi
```

Run `facet search` with no arguments to list all published facets.

## Add a facet

```sh
facet add <source>
```
<sub>[CLI reference ↗](/cli/add)</sub>

`facet add` is the single command for bringing a facet into your project. It writes the entry to `facets.json` and runs the install pipeline in one step. There is no separate "install after add" step.

### Source grammar

| Form                         | Example                                       |
| ---------------------------- | --------------------------------------------- |
| Registry name                | `facet add viper-plans`                        |
| Registry name with version   | `facet add viper-plans@1.2.3`                  |
| Major-pinned wildcard        | `facet add viper-plans@1.*`                    |
| GitHub shorthand             | `facet add github:owner/repo#main`             |
| HTTPS git URL                | `facet add https://github.com/owner/repo.git`  |
| Local path                   | `facet add ./local-facets/my-plans`            |

A bare name (no version) resolves to the latest published version and writes the exact resolved version back to `facets.json`. Wildcards like `1.*` are preserved in `facets.json`; the specific resolved version goes in the lockfile.

You can add multiple facets at once:

```sh
facet add viper-plans rezi planner@2.*
```

See [`facet add`](/cli/add) for the full source grammar and edge cases.

## Understand the project files

After running `facet add`, your project contains two new files:

### `facets.json`

The project manifest. Maps facet names to source specifiers:

```json
{
  "facets": {
    "viper-plans": "1.2.3",
    "rezi": "0.5.0"
  }
}
```

This is the source of truth for which facets belong to the project and at what version.

### `facets.lock`

The lockfile. Records the exact resolved versions, integrity hashes, and asset lists for every installed facet. It ensures reproducible installs across machines.

The lockfile is written by `facet install` and `facet add`. You should commit both `facets.json` and `facets.lock` to version control so that all team members and CI environments get the same versions.

<Info>
The lockfile honors the manifest: a pinned entry is reused as long as it satisfies the manifest specifier. When the manifest and lockfile disagree (you bumped a version or widened a wildcard), `facet install` re-resolves the manifest specifier and updates the lockfile.
</Info>

## Reinstall after git clone

After cloning a project that already has `facets.json` and `facets.lock`:

```sh
facet install
```
<sub>[CLI reference ↗](/cli/install)</sub>

This fetches and materializes every declared facet into your installed adapters. The lockfile ensures you get exactly the same versions your teammates resolved.

For CI environments, use frozen mode to guarantee the lockfile and manifest are already in agreement:

```sh
facet install --frozen-lockfile
```

Frozen mode never re-resolves a specifier and never writes the lockfile. It fails if the manifest and lockfile disagree in any way. A forgotten `facet add`, a hand-edited manifest, or drifted local content fails the build instead of silently mutating the lockfile.

## List installed facets

```sh
facet list
```
<sub>[CLI reference ↗](/cli/list)</sub>

Shows all facets declared in `facets.json`. When `facets.lock` is present, displays the resolved version from the lockfile. For entries not yet installed, shows the source specifier so you know to run `facet install`.

## Remove a facet

```sh
facet remove <name>
```
<sub>[CLI reference ↗](/cli/remove)</sub>

Removes the facet from `facets.json`, deletes its assets from every connected adapter, and rewrites the lockfile without it. Aliased as `facet rm`.

```sh
# Remove a single facet.
facet remove viper-plans

# Remove several at once (all-or-nothing).
facet remove viper-plans rezi
```

If any named facet is not in `facets.json`, the command fails and changes nothing.

## Manage adapters

List installed adapters:

```sh
facet adapter list
```

Remove an adapter:

```sh
facet adapter remove opencode
```

See the [adapter CLI reference](/cli/adapters/install) for full details.
