# Phase 1: supervised ticket-to-draft-PR factory

Phase 1 turns one manually supplied, low-risk ticket into a validated change
and draft pull-request handoff. A human selects the ticket, starts the isolated
worktree, reviews the result, and decides whether to publish or merge it.

## Ticket contract

Provide the workflow with:

- `id`: stable ticket identifier.
- `title`: concise desired outcome.
- `description`: current behavior, desired behavior, and relevant context.
- `acceptanceCriteria`: one or more observable, testable outcomes.
- `risk`: `low`, `medium`, or `high`. Phase 1 accepts only `low`.
- `sourceUrl` (optional): link to the source ticket.

The final repository check is always `bun check` in Phase 1. Callers cannot
replace it with a weaker command.

## Operating procedure

1. Select a low-risk ticket with explicit acceptance criteria.
2. Start a BB thread in a fresh worktree for the project. For example:

   ```sh
   bb thread create \
     --project <project-id> \
     --new-environment worktree \
     --title "Factory: <ticket-id>" \
     --prompt "Qualify this ticket and, if eligible, run the ticket-to-pr workflow."
   ```

3. From that worktree-backed thread, run the saved workflow with JSON input:

   ```sh
   bb workflows run --name ticket-to-pr --args '{
     "ticket": {
       "id": "FAC-123",
       "title": "Describe the desired outcome",
       "description": "Describe current and desired behavior",
       "acceptanceCriteria": ["Observable outcome"],
       "risk": "low"
     }
   }'
   ```

4. Inspect workflow status and the environment diff. Do not publish a pull
   request if the result is `rejected` or `blocked`.
5. If the result is `ready-for-draft-pr`, review the generated title and body,
   inspect the diff, and explicitly decide whether to commit, push, and create
   a draft PR.

## Workflow gates

The workflow executes these gates in order:

1. Qualify the ticket and workspace without editing.
2. Produce a bounded implementation plan.
3. Implement with one writer and run targeted validation.
4. Run the repository validation command.
5. Review correctness, architecture contracts, and test coverage in parallel.
6. Adversarially verify each review's findings against the actual diff.
7. Repair verified findings or validation failures with one writer.
8. Run the final repository validation command.
9. Prepare draft-PR content without publishing it.

## Pilot selection

Prefer documentation fixes, focused validation improvements, small CLI defects,
or behavior changes with established tests. Exclude migrations, releases,
dependency-wide upgrades, authentication, secrets, infrastructure, and broad
cross-package redesigns.

## Phase 1 measures

For each pilot, record ticket-to-handoff duration, first-pass validation result,
human corrections, accepted and rejected review findings, workflow retries,
and any escaped defect. Reassess after four supervised tickets before adding
scheduled intake or automatic publication.
