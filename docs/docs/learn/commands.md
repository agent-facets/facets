---
title: Commands
description: User-invokable workflows that perform specific tasks
---

A command is a markdown file defining a user-invokable workflow. Commands are the action layer of a facet -- they define what happens when the user triggers a specific task.

## File location

```
commands/<name>.md
```

Each command is a single markdown file. The filename (minus `.md`) is the command name.

## Manifest entry

In `facet.json`, commands are declared as a map of name to descriptor:

```json
{
  "commands": {
    "review-pr": { "description": "Run a code review on the current PR" }
  }
}
```

The `description` field is required. Adapter-specific metadata can be declared in the `adapters` field:

```json
{
  "commands": {
    "review-pr": {
      "description": "Run a code review on the current PR",
      "adapters": {
        "claude-code": {
          "allowed_tools": ["read", "grep", "bash"]
        }
      }
    }
  }
}
```

## Content format

The file content is the command's prompt -- the instructions that run when the user invokes the command. YAML front matter is optional and is preserved through the build.

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

When an adapter supports slash commands (e.g., Claude Code's custom commands), the command content defines what happens when the user invokes it.

## When to use commands

Commands define **what the user can trigger** -- a specific workflow or action. Use commands for:

- Code review workflows
- Deployment checklists
- Refactoring tasks
- Report generation
- Test scaffolding

Use [skills](/docs/learn/skills) when you need passive knowledge the assistant should always have. Use [agents](/docs/learn/agents) when you need a persona with specific behavior.

## Further reading

- [Manifest Schema](/specification/manifest) -- the `commands` field in `facet.json`
- [Getting Started](/guides) -- step-by-step guide including writing a command
