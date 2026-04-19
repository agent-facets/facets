---
'@agent-facets/adapter': minor
'@agent-facets/adapter-claude-code': minor
'@agent-facets/adapter-opencode': minor
---

Adapter SDK + first-party adapters gain real install support.

- `@agent-facets/adapter`: add `supportsInstall?: boolean` capability flag on the `Adapter` interface (adapters without it are hidden from the install picker). New shared helpers `installAssetFile` / `readAssetFile` / `deleteAssetFile` handle mkdir + atomic write + optional `<file>.meta.json` sidecar so adapters only own path resolution.
- `@agent-facets/adapter-claude-code`: real `installAsset` / `readAsset` / `deleteAsset` under `~/.claude` (user scope) and `<cwd>/.claude` (project scope); sets `supportsInstall: true`.
- `@agent-facets/adapter-opencode`: same treatment under `~/.config/opencode` + `<cwd>/.opencode`; respects `XDG_CONFIG_HOME` for user scope; sets `supportsInstall: true`.

This is Changeset #1 of the two-changeset install-pipeline ship — release and publish this set first so the CLI changeset (next) can depend on the flipped capability flags.
