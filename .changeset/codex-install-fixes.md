---
"@agent-facets/adapter": minor
"@agent-facets/adapter-codex": minor
---

Add an optional `normalizeForCompare` hook to the adapter contract and fix
two Codex install bugs that depended on it.

**Adapter SDK** — adapters whose on-disk serialization diverges from the
standard YAML front-matter model (TOML files, sidecar-routed metadata) can
now implement `normalizeForCompare(assetType, content, metadata)` to tell
the install pipeline exactly what a round-trip through
`installAsset`/`readAsset` yields. The pipeline uses it for its
skip-if-identical check, falling back to the YAML default (exported as
`normalizeAssetContent`) when absent — existing adapters are unaffected.

**Codex adapter** —

- Agents whose prompts contain a `---` front-matter block are no longer
  re-written ("repaired") on every `facet install`. The TOML round-trip is
  verbatim, so the previous YAML-based comparison never matched.
- Commands now install as Codex *skills* at `.agents/skills/<name>/SKILL.md`
  (Codex has no command concept and never read the old
  `.agents/commands/<name>.md` path). An `agents/openai.yaml` sidecar forces
  `policy.allow_implicit_invocation: false`, so the skill behaves like a
  command: explicit `$name` invocation only. Author-provided `interface` and
  `dependencies` blocks pass through to the sidecar; deleting a command
  removes only the files the adapter wrote (never a recursive directory
  delete).
