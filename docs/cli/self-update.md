---
title: facet self-update
sidebarTitle: ' '
description: Update the facet CLI to a newer version
tag: facet self-update
---

## Usage

```sh
facet self-update
```

`facet self-upgrade` is an alias of the same command.

## What it does

Updates the running `facet` binary in place. Detects how the binary was
installed — the curl installer, an `npm` / `yarn` / `pnpm` / `bun` global
install, dev mode, or an unclassified location — and dispatches to the
matching update mechanism for that path. Existing trust roots (the
[install script](https://agentfacets.io/install) and the user's package
manager) handle download, integrity verification, and the binary swap.

## Flags

| Flag                | Type   | Description                                    |
| ------------------- | ------ | ---------------------------------------------- |
| `--version <x.y.z>` | string | Pin to a specific version instead of latest    |
| `--dry-run`         | bool   | Print the plan; do not modify any files        |
| `--help`            | bool   | Show command help                              |

### Examples

Update to the latest published version:

```sh
facet self-update
```

Pin to a specific version:

```sh
facet self-update --version 0.7.0
```

Preview the plan without changing anything:

```sh
facet self-update --dry-run
```

The `--dry-run` output reports the current and target versions, the
detected install method, and the exact command that would run if you
re-ran without `--dry-run`.

## Install methods

| Detected method | Update command                                    |
| --------------- | ------------------------------------------------- |
| curl installer  | re-runs `agentfacets.io/install` (no PATH change) |
| `npm` global    | `npm install -g agent-facets@<version>`           |
| `yarn` global   | `yarn global add agent-facets@<version>`          |
| `pnpm` global   | `pnpm add -g agent-facets@<version>`              |
| `bun` global    | `bun add -g agent-facets@<version>`               |
| unclassified    | falls back to the curl installer + PATH warning   |

If the binary location can't be classified, `facet self-update` falls back
to the curl installer (which installs to `~/.facet/bin/facet`) and warns
if `facet` on your `$PATH` still resolves to a different binary after the
install — so you can decide whether to remove the older copy or reorder
your `$PATH`.

## Dev mode

When the `FACET_BIN_OVERRIDE` environment variable is set (typical in a
workspace shell where you're testing changes via `bun dev`),
`facet self-update` refuses with a clear stderr message and exits with
code `1`. This is intentional: when you've overridden which binary the
launcher executes, you've taken control of binary placement — self-update
has no business writing over the path you pointed it at. Unset
`FACET_BIN_OVERRIDE` to update a real install.

## Environment variables

| Variable             | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `FACET_CLI_REGISTRY` | Override the npm registry used to look up the latest version                         |
| `FACET_DIR`          | Override the facet directory root (default `~/.facet`); the curl bin lives at `$FACET_DIR/bin/facet` |
| `FACET_BIN_OVERRIDE` | Override which binary the launcher executes; setting this also refuses self-update   |

## Exit codes

| Outcome                                    | Code |
| ------------------------------------------ | ---- |
| Successful update                          | `0`  |
| `--dry-run` (any state)                    | `0`  |
| Already up to date                         | `0`  |
| Dev-mode refusal                           | `1`  |
| Network error / malformed registry data    | `1`  |
| Underlying installer or package manager... | passes through that tool's exit code |
