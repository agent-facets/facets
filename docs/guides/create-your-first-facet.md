---
title: Create Your First Facet
description: Scaffold, write content, build, and verify a facet from scratch
---

By the end of this guide you will have a working `.facet` file ready to publish or share. Make sure you have the CLI installed first -- see the [Introduction](/).

## Scaffold a new facet

<Steps>

<Step title="Run the create wizard">

```sh
facet create my-facet
```

The [`facet create`](/cli/authoring/create) wizard walks you through four prompts:

1. **Name** -- the facet identity: an unscoped name (`my-facet`) or a scoped name (`@scope/name`, e.g. `@acme/my-facet`). Each segment is kebab-case.
2. **Description** -- a brief summary of what the facet does.
3. **Version** -- defaults to `0.0.0`.
4. **Assets** -- add skills, agents, and commands by name. Asset names are always plain kebab-case  -- never scoped, even when the facet identity is. At least one asset is required.

After confirming, the wizard writes the project files.
</Step>

<Step title="Review the generated file tree">

```
my-facet/
├── facet.json
├── skills/
│   └── code-review/
│       └── SKILL.md
├── agents/
│   └── reviewer.md
└── commands/
    └── review-pr.md
```

The exact files depend on what you named during the wizard. Each asset type has a conventional path:

| Asset type | Path convention                      |
| ---------- | ------------------------------------ |
| Skill      | `skills/<name>/SKILL.md`             |
| Agent      | `agents/<name>.md`                   |
| Command    | `commands/<name>.md`                 |
</Step>

</Steps>

## Understand the structure

The manifest (`facet.json`) is the source of truth for what the facet contains:

```json
{
  "name": "my-facet",
  "version": "0.0.0",
  "description": "My first facet",
  "skills": {
    "code-review": { "description": "A Code Review skill" }
  },
  "agents": {
    "reviewer": { "description": "A Reviewer agent" }
  },
  "commands": {
    "review-pr": { "description": "A Review Pr command" }
  }
}
```

All three asset types are maps of name to descriptor, where each descriptor has a required `description` field and optional `adapters` metadata. The name maps to the file at the conventional path (`skills/<name>/SKILL.md`, `agents/<name>.md`, `commands/<name>.md`). At least one text asset must be present.

The manifest's `name`, `description`, and any per-adapter extras are merged on top of whatever YAML front matter you write in the content files at install time.

## Write your first skill

Open `skills/code-review/SKILL.md` and replace the starter template:

```markdown
---
description: Guidelines for reviewing code changes
---

# Code Review

When reviewing code, follow these guidelines:

## Structure
- Check that new files are placed in the correct directory.
- Verify imports are sorted and unused imports are removed.
- Confirm naming conventions match the project style.

## Logic
- Look for off-by-one errors in loops and array access.
- Verify error handling covers all failure paths.
- Check that async operations are awaited.

## Testing
- Every new function should have a corresponding test.
- Edge cases (empty input, null, boundary values) should be covered.
- Tests should not depend on execution order.
```

Skills follow the [Agent Skills](https://agentskills.io/specification) specification. The file is plain markdown. YAML front matter is optional. Any front-matter fields are preserved through the build and merged with the manifest's metadata at install time.

Skills are the directory-based asset type: each skill lives in `skills/<name>/SKILL.md`. This convention comes from the Agent Skills spec and allows skills to include supplementary files alongside the main `SKILL.md` in the future.

## Write an agent

Open `agents/reviewer.md`:

```markdown
You are a code reviewer. Your role is to review code changes for
correctness, style, and maintainability.

## Behavior

- Read the diff carefully before commenting.
- Distinguish between blocking issues and suggestions.
- When you find a bug, explain why it is wrong and suggest a fix.
- Do not comment on formatting if the project uses an autoformatter.

## Tool access

You have access to file reading and grep tools. Use them to check
surrounding context when a diff is ambiguous.
```

Agent files define an AI assistant persona with a specific role and behavior. The content is the agent's system prompt. Adapter-specific metadata (tool lists, model preferences) can be declared in the manifest's `agents.<name>.adapters` block:

```json
{
  "agents": {
    "reviewer": {
      "description": "Reviews code changes",
      "adapters": {
        "opencode": {
          "tools": { "grep": true, "bash": true }
        }
      }
    }
  }
}
```

## Write a command

Open `commands/review-pr.md`:

```markdown
Review the current pull request.

## Steps

1. Read the full diff of the current branch against the base branch.
2. Identify files that changed and their purpose.
3. For each changed file, check for:
   - Logic errors or regressions
   - Missing error handling
   - Untested code paths
4. Write a summary of findings with line references.
5. Classify each finding as "blocking" or "suggestion".
```

Commands are user-invokable workflows. When an adapter supports slash commands (e.g., Claude Code's custom commands), the command content defines what happens when the user invokes it. The manifest entry maps the command name to its description and content file.

## Build the facet

```sh
facet build
```

[`facet build`](/cli/authoring/build) runs a 6-stage validation pipeline:

1. **Parse manifest** -- reads and validates `facet.json` against the schema.
2. **Resolve prompts** -- reads each declared asset file from its conventional path.
3. **Validate assets** -- checks that all content files are non-empty.
4. **Check collisions** -- validates no two assets within the same type share a name.
5. **Validate adapters** -- validates adapter metadata for installed adapters.
6. **Assemble archive** -- collects the manifest and all assets into a deterministic tar archive, computes the integrity hash, and writes the `.facet` file.

On success, the build writes to `dist/`:

```
dist/
└── my-facet-0.0.0.facet
```

A scoped facet identity renders as a nested path: `@acme/my-facet` at `0.0.0` is written to `dist/@acme/my-facet-0.0.0.facet`.

The `.facet` file is the single distributable artifact. Use `--emit-manifest` to also write a loose `build-manifest.json` to `dist/` for debugging:

```sh
facet build --emit-manifest
```

If the build fails, errors are displayed inline under the failed pipeline stage. The error output suggests running [`facet edit`](/cli/authoring/edit) to fix issues.

## Reconcile with `facet edit`

If you add, rename, or remove files on disk without updating `facet.json`, the manifest and the file tree drift apart. [`facet edit`](/cli/authoring/edit) detects this and enters a reconciliation phase:

```sh
facet edit
```

Reconciliation handles two drift cases:

- **New files on disk** not tracked in the manifest -- choose "Add to manifest" or "Ignore for now".
- **Missing files** declared in the manifest but absent from disk -- choose "Scaffold template" or "Remove from manifest".

After reconciliation, the edit phase opens the full authoring workbench where you can modify identity fields (name, description, version) and manage assets. All changes are transactional. Nothing is written to disk until you confirm.
