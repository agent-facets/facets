> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## 1. Update JSON Document — Research

- [ ] 1.1 Explore: the update plan types in the engine — `UpdatePlanRow`, its `candidate` / `current` / `unsupported-source` variants, and the `advancingChoice` and `hasAdvancingChoice` predicates, including which of them are already exported from the engine's public entry point
- [ ] 1.2 Explore: how `build`, `modify` and `create` declare and handle their `--json` flag — flag declaration, where the document is written, whether stderr progress is suppressed, and what they do on failure
- [ ] 1.3 Explore: the current update command's output path — the column-aligned table, the four no-op lines from `describeNoOp`, and the what / detail / fix failure block, so the JSON path can branch cleanly rather than interleave
- [ ] 1.4 Explore: how the update command's exit codes are produced today, and confirm which of them are reached on success versus failure
- [ ] 1.5 Propose: the document's shape and the outcome derivation — field names, `schemaVersion`, the `updated` / `current` / `held` / `unsupported` mapping, the error document, and where the build function sits so it takes data and returns data

## 2. Update JSON Document — Implementation

- [ ] 2.1 Implement: the document types and the pure build function that turns a plan plus a mode into the document, deriving each outcome at serialization time with no new field on any engine type
- [ ] 2.2 Implement: the counts block, tallied from the emitted entries so it cannot disagree with them
- [ ] 2.3 Implement: the error document, carrying the same what / detail / fix triple the prose failure block already reports
- [ ] 2.4 Implement: the `--json` flag on the update command, routing success and failure to stdout as JSON and suppressing the human table when it is set
- [ ] 2.5 Verify: unit tests for every outcome including the unpublished-release ordering case, a test that `--json` selects the same versions as a plain run, and typecheck plus lint for the touched packages

## 3. The outdated Command — Research

- [ ] 3.1 Explore: how commands are registered and dispatched, and what a new top-level command needs in order to appear in help and in the command list
- [ ] 3.2 Explore: how `--dry-run` currently threads through update preparation and application, and the narrowest place to force it to `true` so no later code path can unset it
- [ ] 3.3 Explore: the existing spec requirements for update, dry run and the `self-` prefix reservation, to confirm a bare `outdated` name is consistent with them
- [ ] 3.4 Propose: the shape of the new command — which flags it accepts, whether it emits JSON by default, and how it reuses the update path without duplicating resolution logic

## 4. The outdated Command — Implementation

- [ ] 4.1 Implement: the `outdated` command as the update path with the dry run forced, sharing one code path so the two cannot drift
- [ ] 4.2 Implement: rejection of any flag that would make the command write, and `applied: false` in every document it emits
- [ ] 4.3 Implement: registration, help text, and the per-command help output
- [ ] 4.4 Verify: tests that the command never writes to the project, that its document matches the equivalent `update --json --dry-run` run, and that help lists it

## 5. Specs and Documentation — Research

- [ ] 5.1 Explore: the existing `cli` spec's update requirements and scenarios, to find where the new requirements belong and which existing wording needs amending
- [ ] 5.2 Explore: `docs/cli/update.mdx` and a sibling page that documents a `--json` flag, to match this repo's structure and voice for the new sections
- [ ] 5.3 Propose: the requirement wording for the `cli` spec and the outline of both documentation pages

## 6. Specs and Documentation — Implementation

- [ ] 6.1 Implement: the `cli` spec requirements for the flag, the document shape, the four outcomes, the error document, and the read-only guarantee
- [ ] 6.2 Implement: the `docs/cli/update.mdx` updates — the `--json` flag entry, a section describing the document and its outcomes, and a note that exit codes are unchanged
- [ ] 6.3 Implement: the new `docs/cli/outdated.mdx` page, and list the command in `docs/cli/index.mdx`
- [ ] 6.4 Verify: the documentation site builds, every internal link resolves, and the documented document shape matches the one the tests assert
