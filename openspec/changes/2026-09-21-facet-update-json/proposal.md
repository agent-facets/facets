# Machine-readable output for facet update

## Why

`facet update` can only be read by a person. Its success output is a column-aligned
table of the facets that moved, or, when nothing moved, one of four no-op lines
explaining why. A script that wants to know whether anything is out of date has to
parse that table, and the table is written for humans and free to change.

The exit code does not rescue it. Today `facet update` exits `0` for three different
successful outcomes: updates were applied, updates exist but the declared range
forbids them, and there was nothing to do at all. Those three are the interesting
distinction for anyone automating upgrades, and the exit code blurs all of them into
one number. (It is not true that the command always exits `0` — preparation,
selection, adapter and install failures all exit `1`, and
[`docs/cli/update.mdx`](../../../docs/cli/update.mdx) already documents that. The gap
is only among the successes.)

CI pipelines and dependency bots want a fourth thing the command cannot express at
all: "tell me what is stale, and change nothing." `--dry-run` does that today, but it
still prints the human table, and it is a flag on a command whose name promises to
write.

Three sibling commands have already solved the first half of this. `build`, `modify`
and `create` each declare the same flag — `json: { type: 'boolean', description:
'Emit machine-readable JSON to stdout' }`. `update` is the conspicuous hold-out.

## What Changes

The system SHALL accept a `--json` flag on `facet update`. When the flag is set, the
command SHALL write a single JSON document to stdout and SHALL NOT write the
human-readable table. Every document SHALL carry a schema version so consumers can pin it. Successful
documents SHALL also carry a boolean saying whether the run actually wrote anything,
one entry per planned facet, and a tally of the entries by outcome.

Each facet entry SHALL report exactly one of four outcomes:

- `updated` — this run's flags resolve the facet to a newer release than the version
  locked when the run starts, whether or not the run goes on to write it.
- `current` — nothing newer exists to move to.
- `held` — a newer release exists, and this run leaves it alone. In the default mode
  that is precisely the release the authored specifier forbids.
- `unsupported` — the facet's source cannot be version-checked at all.

A successful document's `applied` boolean SHALL report whether the run actually wrote
anything to the project. A facet entry MAY report `updated` in a document whose
`applied` is `false` — a dry run, for instance, resolves the newer release without
writing it.

Failures SHALL also be expressible as JSON, so a caller that asked for a document
never has to switch parsers halfway through. The error document SHALL carry the same
what / detail / fix triple the command already writes to stderr in prose.

The system SHALL also provide a read-only `facet outdated` command. It SHALL run the
same plan as `facet update --json --dry-run`, with the dry run forced rather than
requested, so it cannot write to the project even by mistake and cannot drift from
the command it reports on.

## Non-goals

**The bump semantics of `facet update` do not change.** This proposal is about output
only. Which release a facet resolves to, when a declared range is rewritten, what
`--latest` means, and what `--interactive` offers all stay exactly as they are. For flag combinations accepted by JSON mode, a run
with `--json` MUST select the same versions as the same run without it and, when
application succeeds, install those versions. JSON mode rejects `--interactive`
and never prompts; required approvals must be supplied before the run.

Exit codes do not change either. `--json` MUST NOT alter which outcomes exit `0` and
which exit `1`; it makes the distinction readable, it does not relocate it.

The human table stays. This adds a second rendering of the same plan, and MUST NOT
reword, reorder or retire the existing one.

`facet outdated` gains no resolution logic of its own. It is a thin, safe alias — not
a second opinion about what is stale.

## Capabilities

### New Capabilities

None. `facet outdated` is a new command inside an existing domain, not a new domain.

### Modified Capabilities

- `cli` — gains machine-readable output for the update workflow and a read-only
  command for inspecting it. The requirements cover the flag, the document's shape,
  the four outcomes, the error document, and the guarantee that the read-only command
  writes nothing.

## Impact

Documentation: [`docs/cli/update.mdx`](../../../docs/cli/update.mdx) informed this
proposal — its Flags, Exit codes and Output sections all describe behavior this
change extends — and MUST gain the `--json` flag and a description of the document.
A new `docs/cli/outdated.mdx` MUST be written for the new command, and the CLI index
MUST list it.

Compatibility: additive. Every existing invocation behaves exactly as it does today.
