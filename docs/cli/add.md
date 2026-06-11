---
title: facet add
description: Adds one or more facets to `facets.json` and installs them
---

## Usage

```sh
facet add <source> [more sources...]
```

Adds the named facet(s) to `facets.json` and immediately installs them into every connected adapter. There is no separate "install after add" step  -- `facet add` is the single command for bringing a new facet into a project.

If the project has no adapters installed, `facet add` will launch the adapter picker before doing any work (in an interactive terminal). In a non-interactive environment, it exits with an error pointing at `facet adapter install`.

## What it does

<Steps>
  <Step title="Parse">
    Validate every source specifier up front. Invalid grammar exits before touching disk.
  </Step>
  <Step title="Discover adapters">
    If none installed: launch the picker (TTY) or fail (non-TTY).
  </Step>
  <Step title="Prepare">
    Read each source's `facet.json` to learn its name. Reject composition (`facets: [...]`). Load the project manifest if it exists.
  </Step>
  <Step title="Commit">
    Delegate to the [install pipeline](/specification/pipeline) with the additions delta. Non-exact specifiers always re-resolve to the newest match. Exact versions with a warm cache skip the download entirely — but creating a new lockfile entry still requires one metadata call to confirm the content against the registry's published integrity. Offline, that confirmation fails closed ("cannot create a lockfile entry without registry confirmation") rather than writing an unconfirmed entry; reproducing an *existing* entry works fully offline.
  </Step>
</Steps>

<Tip>
The manifest, lockfile, and receipt are **never written ahead** of success. On failure, the journal rolls back all materialization and the project is left unchanged.
</Tip>

## Source grammar

`facet add` accepts these source forms:

| Form                              | Example                                          | Notes                                                  |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Registry name                     | `viper-plans`                                    | Equivalent to `viper-plans@latest`. Resolved version is written back to `facets.json` (default-to-pinned). |
| Registry name with version        | `viper-plans@1.2.3`                              | Exact pin.                                             |
| Registry name with `@latest`      | `viper-plans@latest`                             | Re-resolves to the newest published version; `latest` is preserved verbatim in `facets.json` (the entry floats). Only a bare name pins. |
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

Running `facet add` against a facet that's already in `facets.json` is supported:

- Same source as before → no-op (lockfile may report `unchanged` or `repaired`).
- Different version pin → updates the entry; the install summary shows `(was X → Y)`.
- Bare re-add (no version) → resolves the newest published version and **pins** it in `facets.json`. A bare add always pins to the resolved exact version, even over an existing wildcard spec.
- Explicit `@latest`/wildcard re-add → re-resolves to the newest match (the lockfile never pins an explicit non-exact add), but the specifier itself is written verbatim and keeps floating.

## Flags

| Flag        | Description                                |
| ----------- | ------------------------------------------ |
| `--verbose` | Show detailed step output on stderr.       |

## Exit codes

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| `0`  | Add and install succeeded.                                                           |
| `1`  | Failed (parse error, no adapters in non-TTY, install failure, etc.). No files are modified on failure. |

## See also

- [`facet install`](/cli/install)  -- re-runs the install pipeline against the current `facets.json` and lockfile, useful after a fresh `git clone` or to reapply assets after manual edits.
- [`facet adapter install`](/cli/adapters/install)  -- install adapters into your machine.
