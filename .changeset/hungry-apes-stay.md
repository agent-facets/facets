---
"agent-facets": minor
---

Make the CLI agent-friendly with non-interactive authoring, machine-readable
output, and built-in agent instructions.

- **`facet instructions [topic]`** (new): prints agent-oriented usage guidance
  for the CLI. Topics: `overview` (default), `manifest`, `authoring`, `usage`.
  The `manifest` topic emits the facet.json JSON Schema generated live from the
  schema definition.
- **`facet modify`** (new): headless, flag-driven authoring — the scriptable
  counterpart to the interactive `facet edit` wizard. Add, remove, rename, or
  re-describe skills/agents/commands, set facet metadata (`facet modify facet
  --version …`), and set per-asset adapter config with `--adapter-<name> '<json>'`
  / `--remove-adapter-<name>`. Supports `--json`.
- **`facet create` headless flags** (new): `--name`, `--description`,
  `--version`, `--private`, repeatable `--skill`/`--agent`/`--command`, and
  `--json`. Passing any of these scaffolds without the interactive wizard;
  `--force` is required to overwrite an existing facet.json.
- **`facet build --verify`** (new): runs the full build pipeline and reports
  validation results without writing any output. **`facet build --json`** (new):
  emits a machine-readable build/verify result.
- **Fix:** `facet modify facet --version <v>` and other subcommand flags named
  `--version` are no longer shadowed by the global `--version` flag, which now
  only applies before the command name.
