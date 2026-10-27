---
name: intake-ticket
description: Qualify one proposed ticket for the supervised Phase 1 ticket-to-PR factory before any files are changed.
---

# Intake ticket

Qualify exactly one ticket. This skill is for factory intake, not general issue
triage or backlog prioritization.

## Eligibility check

Inspect the ticket, repository guidance, current Git status, and relevant code
without editing files. Accept only when:

- The goal and every acceptance criterion are observable and unambiguous.
- Risk is explicitly `low`.
- The likely change is bounded, reversible, and owned by one implementer.
- Affected packages and their `AGENTS.md` instructions can be identified.
- A credible targeted-test path exists and `bun check` remains the final gate.
- The workspace is an isolated worktree with no overlapping unrelated changes.
- The work needs no secrets, production data migration, infrastructure change,
  security-sensitive redesign, release, push, or merge.

Do not improve an ineligible ticket by silently inventing requirements. Return
the missing decision or constraint as the rejection reason.

## Output

Return an eligibility decision, concise reason, normalized goal, normalized
acceptance criteria, expected affected areas, and risk. When used by a workflow,
match its requested structured schema exactly.

Completion means either the ticket is safe to plan or it has been rejected
before any repository mutation.
