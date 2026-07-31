---
'agent-facets': minor
---

**Cross-facet name collision resolution and asset aliasing (pre-1.0 breaking minor).**

Two facets can now publish an asset with the same name without one silently
overwriting the other. `facet add`, `facet install`, and `facet remove` detect
every cross-facet collision across the complete desired asset set before
writing anything, and stop.

**Interactive resolution.** When the terminal can prompt — stdin and stdout are
both TTYs, raw mode is available, and the process is not in CI — the install
pauses and opens a resolution workspace inside the existing install view. Each
contested asset gets one of three outcomes: keep the authored name, alias it to
a name you type, or omit it entirely. Arrow keys move a cursor and `Enter`
applies, so the alias editor cannot trap focus and make `Omit` unreachable.
Status is three-state and readable without color (`✕ unresolved`, `⚠ conflict`,
`✓ resolved`). Confirmation unlocks only when the planner — not a count of green
rows — reports the whole draft collision-free. `Esc` or `Ctrl-C` cancels the
install with nothing written; Ink's built-in Ctrl-C handling is disabled so the
cancellation settles the engine's pending resolver and releases the project
lock.

**Non-interactive resolution.** In CI, with piped output, or under
`--frozen-lockfile`, nothing is prompted. The command exits non-zero and writes
a full report to stderr: every group, every claimant, the exact
`facets.json` location to edit, and parseable alias/omit snippets. It chooses no
winner and invents no alias — the placeholder is literally `choose-a-name` and is
offered identically to every claimant — and states explicitly that
`facets.json`, `facets.lock`, the receipt, and materialized assets were not
changed. Frozen mode never prompts even on a full TTY, because it reproduces
recorded intent rather than collecting new decisions.

**BREAKING: `facets.json` gains `manifestVersion: 0.1` and expanded entries.** A
facet entry is now either a source string or `{ source, materialization }`. Any
tool reading `facets.json` must handle both forms; code assuming a flat
`Record<string, string>` will discard recorded aliases when it rewrites the
file. A manifest with no `manifestVersion` is read as legacy and migrated in
place inside the same transaction that writes the lockfile and receipt. An
entry whose last override is removed collapses back to a compact string, and
`//` and `/* */` comments survive a write.

**BREAKING: `facets.lock` moves to `0.3` and the receipt to `0.3`.** Every
lockfile asset entry carries a required `materialization` disposition; omitted
assets stay listed with their complete authored file records. `name` and `files`
remain authored even when aliased, so integrity is unaffected. Legacy `1` and
`0.2` lockfiles remain readable and are migrated by any non-frozen install.
A frozen install fails with `materialization-unrepresentable` when the manifest
declares overrides against a pre-`0.3` lockfile.

**The install pipeline is now Resolve-all → Compose → Apply.** The previous
interleaved per-facet loop could not detect a collision between the first and
last facet, because the first was already on disk. Resolve-all and Compose are
read-only, so a collision, invalid alias, or cancellation leaves the project
byte-identical with no rollback needed. Apply deletes obsolete assets in one
global pass keyed by effective adapter identity *before* writing, which makes
ownership transfer between facets correct and stops a duplicate historical claim
from double-deleting.

**Other user-visible changes.**

- A version-unchanged disposition change classifies as `updated`, not
  `unchanged` or `repaired`.
- The install summary names every asset whose materialized name differs from its
  authored one (`planning → team-planning`, `scratch — omitted`), and omitted
  assets are excluded from asset counts.
- Stale overrides — naming an asset the resolved version no longer contains —
  are pruned on a successful commit and reported without `--verbose`. Frozen
  mode treats them as blocking drift.
- `facet list` reports an unsupported `manifestVersion` distinctly from a
  malformed manifest.
- Adapters receive the **effective** asset name in every install, read, and
  delete request. The adapter API version is unchanged and no adapter needs
  rebuilding.
- `facet instructions` now teaches agents both `facets.json` entry forms and the
  hand-edit path for resolving a collision without a TTY.
