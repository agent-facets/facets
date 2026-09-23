# Design — Machine-readable output for facet update

## Context

### The gap

`facet update` renders its plan once, for a person. Success is a column-aligned table
of the facets that moved; when nothing moved, it is one of four no-op lines from
`describeNoOp`, each naming a different reason. Failure is a prose what / detail / fix
block on stderr. None of it is parseable, and none of it is stable enough to promise
to a script.

The exit code cannot stand in. `facet update` exits `0` on every successful outcome —
updates applied, updates blocked by the declared range, nothing to do — so the one
number a script can read reliably collapses the three cases it most wants to tell
apart. Failures do exit `1` (preparation, selection, adapter, install), and
`docs/cli/update.mdx` documents that already; the ambiguity is entirely on the success
side.

There is also no safe way to ask the question. `--dry-run` computes the plan without
writing, but it lives on a command named for writing, and a caller has to trust itself
to keep passing the flag.

### Constraints carried forward

The engine deliberately does not store an "is this outdated?" answer. `UpdatePlanRow`'s
doc comment says why:

> `candidate` and `current` split what a single "outdated?" boolean would blur: a
> candidate has at least one choice newer than what is installed, and `advancingChoice`
> says which. That predicate is not mirrored into a field here on purpose — a stored
> summary of the two versions sitting beside the two versions is a second answer
> waiting to disagree with the one application enforces.

That reasoning binds this change. Whatever the document reports MUST be computed from
the same versions and the same engine predicates that the run itself obeys.

Two more constraints hold. The human table is load-bearing and MUST survive unchanged.
And `--json` MUST NOT change which versions get selected or installed — the document
describes the run, it does not steer it.

## Goals / Non-Goals

Goals: a versioned JSON document on stdout for `facet update`; four unambiguous
per-facet outcomes; a JSON error document so a caller never switches parsers midway; a
read-only `facet outdated` that cannot write; documentation that keeps up.

Non-Goals: no change to bump semantics, resolution, exit codes, or the human table. No
new engine state. No configuration file for output format.

## Decisions

### 1. The outcome is derived at serialization time, never stored on an engine type

The four outcomes — `updated`, `current`, `held`, `unsupported` — SHALL be computed
while building the document, from the plan row and the mode the run is in. No outcome
field SHALL be added to `UpdatePlanRow` or to any other engine type.

This follows directly from the doc comment quoted above: a stored summary sitting
beside the versions it summarizes is "a second answer waiting to disagree with the one
application enforces." An `outcome` field on a plan row would be exactly that — it
would be written once, during planning, and would then have to be kept true through
selection, interactive editing and application. Deriving it at the moment of
serialization means the document is a projection of the state the run actually used,
and there is no second copy to fall out of step.

Concretely, the derivation asks the engine, in order: does this run advance the facet
(`advancingChoice` for the current mode)? Then `updated`. Otherwise, does anything
newer exist in either the range column or the latest column (`hasAdvancingChoice`)?
Then `held`. Otherwise `current`. A row with no checkable facet at all is
`unsupported`. The order matters: asking only about the latest column would misreport a
facet as `current` when the registry's newest release has moved backwards while the
range target still advances.

`held` is therefore about what this run does, not about the range in the abstract: a
newer release exists and this invocation leaves it where it is. In the default mode
that is precisely the release the authored specifier forbids, which is the case the
exit code cannot currently express. Under `--latest` the same facet would be `updated`.

The counts block SHALL be tallied from the entries that were actually emitted, for the
same reason — it is a sum of the document, not an independent count.

### 2. `facet outdated` is `facet update --dry-run` with the dry run forced

`facet outdated` SHALL be implemented as the update command with `dryRun` fixed to
`true`, rather than as a parallel implementation. It SHALL NOT accept flags that would
make it write, and `applied` in its document SHALL always be `false`.

The point is that the two can never drift. If `outdated` re-derived staleness on its
own, every change to resolution would have to be made twice and the second copy would
eventually lag. Sharing the one code path makes agreement structural rather than
something a test has to keep checking. The command is a safety and discoverability
affordance: a name that says what it does, which cannot write even if invoked wrongly.

## Risks / Trade-offs

The document shape becomes a contract the moment anyone pins it. Mitigation: ship a
`schemaVersion` field from the first release and bump it on any shape change, matching
what the sibling `--json` commands do.

Deriving outcomes at serialization time means the logic lives in the presentation
layer, which is slightly unusual. The alternative is worse for the reason the engine
already documented, and the derivation is pure — plan in, document out — so it is
directly testable without stubbing stdout or a process.

`facet outdated` adds surface area for something that is arguably a flag. Accepted: the
read-only guarantee is the product, and it cannot be given by a flag a caller might
forget.

## Migration Plan

Additive throughout. `--json` defaults off, so every existing invocation is untouched;
`facet outdated` is a new name that collides with nothing. There is no state to
migrate, no lockfile change, and no deprecation. The change can land in one release.

## Documentation updates

- `docs/cli/update.mdx` — add `--json` to the Flags section; add a section describing
  the document, its `schemaVersion`, the four outcomes, and the error document; note in
  Exit codes that `--json` does not change them.
- `docs/cli/outdated.mdx` — new page for the command: usage, that it never writes, the
  document it emits, and a cross-reference to `update`.
- `docs/cli/index.mdx` — list the new command.

No existing documentation contradicts this design; the update page describes behavior
this change extends rather than replaces.

## Open Questions

- Should `facet outdated` accept `--json=false` to print the human table, or always
  emit JSON? Leaning toward accepting the human table, since the name is also useful
  interactively.
- Should the error document be emitted on stdout alongside the prose block on stderr,
  or replace it? Leaning toward replacing it under `--json`, so stdout is the single
  parseable channel.
