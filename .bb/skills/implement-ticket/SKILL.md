---
name: implement-ticket
description: Implement one accepted low-risk factory ticket as the sole writer in its isolated worktree and validate the focused change.
---

# Implement ticket

Use only after `intake-ticket` has accepted the ticket and a bounded plan exists.
You are the sole implementation writer for this step.

## Work contract

- Read the root and every affected package's `AGENTS.md` before editing.
- Inspect existing implementation and tests before choosing a change.
- Implement only the accepted goal and acceptance criteria.
- Preserve unrelated changes; do not perform opportunistic refactors.
- Follow the repository's result-value error model and runtime boundaries.
- Add or update tests that prove the behavior rather than implementation
  details.
- Run the narrowest useful checks during implementation.
- Use `bun format` for Biome formatting errors instead of hand-formatting.

If the plan becomes inaccurate, the scope expands materially, or required
behavior is ambiguous, stop and report a blocker. Do not push, publish, merge,
release, or weaken tests and checks.

## Output

Report whether implementation completed, a factual summary, changed files,
commands run with outcomes, and blockers. When used by a workflow, match its
requested structured schema exactly.

Completion means the focused implementation and tests are present in the
worktree and targeted validation has been executed; repository-wide validation
is a separate workflow gate.
