# Changesets

This directory is used by [changesets](https://github.com/changesets/changesets) to track version bumps and changelog entries.

## For contributors

Before submitting a PR, run:

```
bun change
```

Follow the prompts to select a bump type (patch/minor/major) and write a summary of your changes. Commit the generated `.md` file with your PR.

A good changeset describes:
- **What** the change is
- **Why** the change was made
- **How** a consumer should update their code (if applicable)

Not every PR needs a changeset — changes to docs, CI, or other non-published files can skip this step. The [changeset bot](https://github.com/apps/changeset-bot) will comment on your PR to let you know if one is missing.

## For maintainers

See the [Release Pipeline](https://docs.agentfacets.io/contributing/release-pipeline) docs for the full end-to-end release flow.
