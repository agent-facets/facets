---
'agent-facets': minor
---

Add `facet self-update` (alias `facet self-upgrade`) to update the CLI in-band.

The command detects how the running binary was installed — curl installer,
`npm` / `yarn` / `pnpm` / `bun` global, dev mode, or unclassified — and
dispatches to a matching update mechanism. Reuses the existing curl
installer at `agentfacets.io/install` and the user's package manager
rather than duplicating download/integrity logic. Honors
`FACET_CLI_REGISTRY` for version metadata.

Two flags: `--version <x.y.z>` to pin a release and `--dry-run` to print
the plan without executing it. Refuses gracefully in dev mode (when
`FACET_BIN_PATH` is set) with a clear stderr message.

Also adds a generic `aliases` field to the `Command` type so future
commands can declare alternate names without duplicating registrations.
