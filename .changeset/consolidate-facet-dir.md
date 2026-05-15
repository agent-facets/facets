---
"agent-facets": minor
---

**Breaking:** Consolidate every directory env var into a single
`FACET_DIR`, rename the launcher binary override, and move the install
advisory lock out of the project root.

## What changed

One env var, `FACET_DIR` (default `~/.facet`), now controls every
directory the facet CLI writes to disk. Everything lives under it:

- `$FACET_DIR/bin/` — curl-installed binary
- `$FACET_DIR/cache/` — content-addressed cache for fetched payloads
- `$FACET_DIR/adapters/` — installed adapter bundles
- `$FACET_DIR/locks/` — install advisory locks (one file per project,
  keyed by `<basename>-<sha256(realpath)[:16]>.lock`)

The launcher's binary override is renamed:

- `FACET_BIN_PATH` → `FACET_BIN_OVERRIDE`

The name carries the semantics: setting it overrides which binary the
launcher executes, and `facet self-update` continues to refuse while
it's set because overriding means you've taken control of binary
placement.

The install advisory lock moves out of the project root. Previously it
was `<projectRoot>/.facets/.install.lock` (a directory `facet install`
silently materialized in every project). Now it lives at
`$FACET_DIR/locks/<basename>-<hash>.lock`, keyed by the project's
canonical path. The project root stays clean — `facet install` writes
nothing next to `facets.json`.

## Removed env vars

Hard rename, no aliases. Old names are silently ignored; values fall
back to defaults until users rename in their shell rc files or CI configs:

- `FACETS_CACHE_DIR`
- `FACETS_ADAPTERS_DIR`
- `FACET_CACHE_DIR`
- `FACET_ADAPTERS_DIR`
- `FACET_INSTALL_DIR`
- `FACET_BIN_PATH`

`FACET_CLI_REGISTRY` and `FACET_VERSION` (used by `install.sh`) are
unchanged.

## No migration

Existing cached payloads and adapters at `~/.facets/` are not detected,
copied, or warned about. The new code reads `$FACET_DIR` only.
Users may delete `~/.facets/` at any time; the new code will rebuild
cache and adapters on first use.
