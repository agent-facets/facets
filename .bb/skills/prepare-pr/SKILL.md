---
name: prepare-pr
description: Prepare an evidence-based draft pull-request handoff for a validated factory change without publishing, pushing, or merging it.
---

# Prepare PR handoff

Use only after the final repository validation gate passes. Remain read-only.

Inspect the ticket, final diff, validation evidence, and verified findings. Draft:

- A concise imperative PR title.
- A body describing why the change is needed and what changed.
- A checklist mapping validation evidence to acceptance criteria.
- Residual risks, manual review points, and any deliberately excluded scope.

Do not claim a command passed unless the workflow supplies or you directly
observe that evidence. Do not create commits, push branches, open a PR, mark it
ready, merge it, or release it unless the user separately and explicitly
authorizes that external action.

Completion means a human can inspect the diff and use the handoff to create a
draft PR without reconstructing the run's reasoning.
