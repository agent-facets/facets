# Phase 1 software factory

These instructions apply to BB threads working in this repository. The root
and package-level `AGENTS.md` files remain authoritative for architecture,
runtime, testing, and formatting rules.

## Factory boundary

When a thread is running the ticket-to-PR factory or one of its skills:

- Work on exactly one accepted ticket in an isolated Git worktree.
- Require a concrete goal and testable acceptance criteria before editing.
- Phase 1 accepts only low-risk, reversible work with a bounded blast radius.
- Keep one implementation writer. Review and verification workers are
  read-only unless the workflow explicitly assigns a repair step.
- Preserve unrelated user changes and never rewrite or discard them.
- Do not push, publish, merge, release, or mark a pull request ready without
  explicit user authorization.
- Treat `bun check` as the final repository-wide quality gate. Targeted tests
  may provide faster feedback but do not replace it.
- Report blockers as structured data. Do not silently broaden scope to work
  around unclear requirements, missing credentials, infrastructure changes,
  or an unexpectedly large change.

## Phase 1 ticket eligibility

Accept a ticket only when all of the following are true:

- The requested behavior and acceptance criteria are unambiguous.
- The change is low risk, readily reversible, and small enough for one owner.
- No production data migration, credential change, infrastructure mutation,
  security-sensitive redesign, or automatic release is required.
- The relevant package rules and a credible validation path can be identified.
- The current workspace is an isolated worktree and does not contain unrelated
  changes that overlap the ticket.

If any condition fails, stop before editing and explain what must change before
the ticket can enter the factory.

## Completion contract

A factory run is ready for draft-PR handoff only when:

- The implemented behavior satisfies every acceptance criterion.
- Relevant targeted tests pass.
- Independent findings have been verified against the actual diff.
- Verified findings have been repaired or explicitly reported as blockers.
- The final `bun check` passes.
- The handoff describes the change, validation evidence, residual risk, and
  manual review points without claiming that a PR was published.
