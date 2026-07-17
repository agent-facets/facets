---
"@agent-facets/adapter": minor
"@agent-facets/adapter-codex": minor
"agent-facets": minor
---

Add two optional adapter hooks (`normalizeForCompare`, `resolvePath`) and fix
a set of Codex install-correctness bugs that depend on them.

**Adapter SDK** —

- `normalizeForCompare(assetType, content, metadata)`: adapters whose on-disk
  serialization diverges from the standard YAML front-matter model (TOML
  files, sidecar-routed metadata) can tell the install pipeline exactly what a
  round-trip through `installAsset`/`readAsset` yields. The pipeline uses it
  for its skip-if-identical check, falling back to the YAML default (exported
  as `normalizeAssetContent`) when absent.
- `resolvePath(scope, assetType, name)`: reports the on-disk path an asset
  serializes to. The install pipeline uses it to detect two distinct assets
  that collide on a single path and fails loud (`ASSET_PATH_COLLISION`) before
  any write, instead of letting one silently clobber the other.

Both hooks are optional — existing adapters are unaffected.

**Codex adapter** —

- Agents whose prompts contain a `---` front-matter block are no longer
  re-written ("repaired") on every `facet install`. The TOML round-trip is
  verbatim, so the previous YAML-based comparison never matched.
- Commands install as Codex *skills* at `.agents/skills/<name>/SKILL.md`
  (Codex has no command concept and never read the old
  `.agents/commands/<name>.md` path). An `agents/openai.yaml` sidecar forces
  `policy.allow_implicit_invocation: false`, so the skill behaves like a
  command: explicit `$name` invocation only. Author-provided `interface` and
  `dependencies` blocks pass through to the sidecar.
- A command and a skill that share a name (both mapping to the same
  `.agents/skills/<name>/SKILL.md`) are now caught by the pipeline's
  collision check rather than silently clobbering each other.
- Upgrades converge cleanly: installing or deleting a command sweeps the
  legacy `.agents/commands/<name>.md` file an older adapter version left
  behind, so it is no longer orphaned.
- Sidecar drift is repaired: `readAsset` now folds `agents/openai.yaml` back
  into a command's metadata, so a hand-edited or deleted sidecar (e.g. an
  author flipping `allow_implicit_invocation` back to `true`) is detected and
  rewritten on the next install rather than persisting silently.
- Deleting a namespaced command (e.g. `viper-plans/plan`) prunes the emptied
  namespace parent directory, while still never recursively deleting a sibling
  skill that shares the namespace prefix.
