---
title: Environment Variables
description: Environment variables that configure where facet stores state
---

## Environment Variables

A small set of environment variables controls where the facet CLI writes
state and which binary the launcher runs. Two are user-facing; the rest
are for tests and specialized installs.

### `FACET_DIR`

The single base directory for everything the facet CLI manages on disk:
the content-addressed cache, installed adapters, install advisory locks,
and (for curl installs) the binary itself.

| Subdirectory          | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `$FACET_DIR/bin/`     | Curl-installed binary (`$FACET_DIR/bin/facet`)                 |
| `$FACET_DIR/cache/`   | Content-addressed cache for fetched facet payloads             |
| `$FACET_DIR/adapters/`| Installed adapter bundles                                      |
| `$FACET_DIR/locks/`   | Per-project install advisory locks (one file per project root) |

**Default:** `~/.facet/`. Setting `FACET_DIR` is the override  -- there are
no separate per-subsystem env vars.

```sh
export FACET_DIR=/opt/facet
facet adapter install opencode
# adapter lands in /opt/facet/adapters/opencode/adapter.js
# cache lands in /opt/facet/cache/<name>@<version>/
# install locks land in /opt/facet/locks/<basename>-<hash>.lock
```

Whitespace-only values (`FACET_DIR=`, `FACET_DIR=" "`) are treated as
unset so a misconfigured shell rc doesn't accidentally point everything
at a relative path. Surrounding whitespace is trimmed.

### `FACET_BIN_OVERRIDE`

A direct override of the binary the launcher executes. When set, the
launcher skips its normal resolution (cached hard-link, platform
package lookup, etc.) and runs the binary at the override path.

```sh
export FACET_BIN_OVERRIDE=/home/me/dev/facets/packages/cli/dist/facet
facet --version   # runs the binary at the override path
```

Setting `FACET_BIN_OVERRIDE` also disables `facet self-update`: when
you've overridden which binary runs, self-update has no business writing
over whatever you pointed it at. Unset the variable to re-enable
self-update for a real install.

This variable is primarily for CLI development. End users should not set
it; if you want to control where the curl installer puts the binary, set
`FACET_DIR` instead.

### `FACET_CLI_REGISTRY`

Overrides the npm registry base URL the curl installer and self-update
use to fetch CLI tarballs. Defaults to `https://registry.npmjs.org`.

### `FACET_VERSION`

Read by the curl installer (`install.sh`) as an alternative to
`--version`. If both are set, the flag wins.
