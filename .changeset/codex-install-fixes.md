---
"@agent-facets/adapter": minor
"@agent-facets/adapter-codex": minor
---

Add an optional `normalizeForCompare` adapter hook and fix a set of Codex
install-correctness bugs.

**Adapter SDK** —

- `normalizeForCompare(assetType, content, metadata)`: adapters whose on-disk
  serialization diverges from the standard YAML front-matter model (TOML
  files, sidecar-routed metadata) can tell the install pipeline exactly what a
  round-trip through `installAsset`/`readAsset` yields. The pipeline uses it
  for its skip-if-identical check, falling back to the YAML default when
  absent. The hook is optional — existing adapters are unaffected.
- `normalizeAssetContent` — the default compare normalization — now lives in
  `@agent-facets/common` and is re-exported from the SDK (public API
  unchanged, same pattern as `splitAssetContent`), so the SDK and the install
  pipeline share one implementation instead of two copies that could drift.

**Codex adapter** —

- Agents whose prompts contain a `---` front-matter block are no longer
  re-written ("repaired") on every `facet install`. The TOML round-trip is
  verbatim, so the previous YAML-based comparison never matched. The compare
  now mirrors the install→read round-trip exactly, and `developer_instructions`
  is rejected as a reserved metadata key (it is the slot the adapter writes the
  prompt body into, not author input).
- Commands install as Codex *skills* at `.agents/skills/<name>/SKILL.md`
  (Codex has no command concept and never read the old
  `.agents/commands/<name>.md` path). An `agents/openai.yaml` sidecar forces
  `policy.allow_implicit_invocation: false`, so the skill behaves like a
  command: explicit `$name` invocation only. Author-provided `interface` and
  `dependencies` blocks pass through to the sidecar.
- Sidecar drift is repaired: `readAsset` folds `agents/openai.yaml` back into a
  command's metadata, so a hand-edited or deleted sidecar (e.g. an author
  flipping `allow_implicit_invocation` back to `true`) is detected and
  rewritten on the next install rather than persisting silently.
- Upgrades converge cleanly: installing or deleting a command sweeps the legacy
  `.agents/commands/<name>.md` file an older adapter version left behind, so it
  is no longer orphaned.
- Deleting a namespaced command (e.g. `viper-plans/plan`) prunes the emptied
  namespace parent directory, while still never recursively deleting a sibling
  skill that shares the namespace prefix.
