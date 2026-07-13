---
"@agent-facets/protocol": minor
"agent-facets": minor
---

Enforce the Agent Skills name grammar for skill, command, and agent names everywhere names enter the system.

`@agent-facets/protocol` gains a canonical asset-name grammar (`schemas/asset-name.ts`) modeled on the [Agent Skills spec](https://agentskills.io/specification#name-field). New exports: `parseAssetName`, `parseAssetNameSegment`, `validateAssetName`, and `validateAssetNameSegment`, along with the `AssetNameResult` and `AssetNameSegmentResult` types. A single segment is 1–64 characters of lowercase ASCII letters, digits, and hyphens, must not start or end with a hyphen, and must not contain consecutive hyphens. Full asset names may carry `/`-separated namespace segments (`viper-plans/planning`), each validated independently; the parsers return discriminated-union results instead of throwing.

BREAKING CHANGE: `FacetManifestSchema` now validates every asset name against this grammar instead of the previous path-safety-only check. Manifests declaring non-conforming asset names (uppercase like `MySkill`, underscores like `foo_bar`, leading/trailing or consecutive hyphens, names over 64 characters) now fail at build **and** install — the schema validates fetched manifests too — rather than passing silently. Digit-start names (`2fa`) are now valid, diverging from the stricter facet-identity slug grammar. Lockfile asset names intentionally keep the weaker path-safety guard so existing installs continue to load and can be removed.

The `agent-facets` CLI routes `facet create` (wizard and headless), the create/edit TUI views, and `facet modify` (`--add` and `--rename`) through the shared validator, surfacing the grammar's own reason strings in errors. `facet modify --update`/`--remove` still accept legacy non-conforming names so users can fix or remove them.
