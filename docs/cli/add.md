---
title: facet add
sidebarTitle: add
description: Adds one or more facets to `facets.json` and installs them
tag: facet add
---

## Usage

```sh
facet add <source> [more sources...]
```

Adds the named facet(s) to `facets.json` and immediately installs them into every connected adapter. There is no separate "install after add" step  -- `facet add` is the single command for bringing a new facet into a project.

If the project has no adapters installed, `facet add` will launch the adapter picker before doing any work (in an interactive terminal). In a non-interactive environment, it exits with an error pointing at `facet adapter install`.

## What it does

1. **Parse every source** up front. If any source has invalid grammar (see [Source grammar](#source-grammar) below), the command exits before touching disk.
2. **Discover adapters.** If none are installed: launch the picker on a TTY, fail on a non-TTY.
3. **Snapshot `facets.json`** byte-for-byte. If anything fails downstream, the manifest is restored exactly as it was.
4. **Read each source's `facet.json`** to learn its name and version.
5. **Reject composition.** A source whose `facet.json` declares `facets: [...]` is rejected before any state mutation.
6. **Write `facets.json`** with the new entries.
7. **Run the install pipeline**  -- fetch, verify integrity, materialize assets into every adapter, write the lockfile.
8. **On any failure**, restore the `facets.json` snapshot. The project is left exactly as it was before the command ran.

## Source grammar

`facet add` accepts these source forms:

| Form                              | Example                                          | Notes                                                  |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Registry name                     | `viper-plans`                                    | Equivalent to `viper-plans@latest`. Resolved version is written back to `facets.json` (default-to-pinned). |
| Registry name with version        | `viper-plans@1.2.3`                              | Exact pin.                                             |
| Registry name with `@latest`      | `viper-plans@latest`                             | Equivalent to bare-name; resolved exact version is written back. |
| Registry name with wildcard       | `viper-plans@*`, `1.*`, `1.2.*`                  | Wildcard preserved in `facets.json`; resolved exact version goes in the lockfile. |
| GitHub shorthand                  | `github:owner/repo`, `github:owner/repo#main`    | Optional `#ref` (branch, tag, SHA).                    |
| HTTPS git URL                     | `https://github.com/owner/repo.git#v1.0.0`       | Must end in `.git`.                                    |
| SCP-style git URL                 | `git@github.com:owner/repo.git#main`             | Standard `user@host:path` SSH form.                    |
| Local path                        | `./facets/viper-plans`, `/abs/path`, `~/foo`     | Must resolve inside the project tree.                  |
| `file:` prefix                    | `file:./facets/viper-plans`                      | Tolerated; the prefix is stripped and the rest is treated as a local path. |

### Forms that are rejected

| Form                              | Reason                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `git+https://...`, `git+ssh://...`| The `git+` prefix is not supported. Drop it: `https://...git`, `git@host:owner/repo`. |
| `^1.2.3`, `~1.2.3`                | Caret/tilde ranges. Use `1.*` for major-pinned, `1.2.*` for minor-pinned, or `1.2.3` for exact. |
| `>=1.0.0`, `<2.0.0`, `1.0.0 \|\| 2.0.0` | Comparator and OR ranges. Pick one version.                                       |
| `1.x`, `1.2.x`                    | x-style placeholders. Use `1.*` or `1.2.*` instead.                                   |

## Examples

```sh
# Bare name  -- resolves to the latest published version, writes the
# exact resolved version back to facets.json.
facet add viper-plans

# Pinned version  -- written verbatim to facets.json.
facet add viper-plans@1.2.3

# Major-pinned wildcard  -- wildcard preserved, lockfile records the
# specific resolved version.
facet add viper-plans@1.*

# GitHub shorthand with a ref.
facet add github:agent-facets/viper-plans#main

# Local path under the project tree.
facet add ./local-facets/my-plans

# Multiple sources in one command.
facet add viper-plans rezi planner@2.*
```

## Re-adding a facet

Running `facet add` against a facet that's already in `facets.json` is supported and idempotent at the manifest level:

- Same source as before → no-op (lockfile may report `unchanged` or `repaired`).
- Different version pin → updates the entry; the install summary shows `(was X → Y)`.
- Bare re-add (no version) over an existing **valid** version spec → the spec is **preserved**. A bare re-add never clobbers a deliberate pin or range  -- re-running `facet add viper-plans` won't overwrite a `viper-plans@1.*` you set on purpose.
- Bare re-add over an **invalid** value (e.g. a stale entry where the name leaked into the version position) → the value is **healed** to the resolved exact version.

## Flags

| Flag        | Description                                |
| ----------- | ------------------------------------------ |
| `--verbose` | Show detailed step output on stderr.       |

## Exit codes

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| `0`  | Add and install succeeded.                                                           |
| `1`  | Failed (parse error, no adapters in non-TTY, install failure, etc.). `facets.json` is restored byte-for-byte on every failure path. |

## See also

- [`facet install`](/cli/install)  -- re-runs the install pipeline against the current `facets.json` and lockfile, useful after a fresh `git clone` or to reapply assets after manual edits.
- [`facet adapter install`](/cli/adapters/install)  -- install adapters into your machine.
