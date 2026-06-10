---
title: Skills
description: Reusable knowledge and guidelines that shape how AI assistants work
---

A skill is a markdown file containing domain-specific instructions, guidelines, or best practices. Skills follow the [Agent Skills](https://agentskills.io/specification) specification. They are the passive knowledge layer of a facet -- text that shapes how an AI assistant approaches a domain without defining a persona or a user-invokable action.

## File location

Skills use the Agent Skills directory convention:

```
skills/<name>/SKILL.md
```

Each skill gets its own directory. The main file must be named `SKILL.md`. This convention allows skills to include supplementary files alongside the main skill file in the future.

## Manifest entry

In `facet.json`, skills are declared as a map of name to descriptor:

```json
{
  "skills": {
    "code-review": { "description": "Guidelines for reviewing code changes" },
    "testing-guidelines": { "description": "Testing best practices" }
  }
}
```

Each name maps to the directory `skills/<name>/SKILL.md`. At build time, the build pipeline resolves each skill name to its file and validates that the file exists and is non-empty. The `description` field is required.

Per-adapter configuration can be declared in the manifest using the `adapters` field on the skill descriptor:

```json
{
  "skills": {
    "code-review": {
      "description": "Guidelines for reviewing code changes",
      "adapters": {
        "opencode": { "globs": ["**/*.ts"] }
      }
    }
  }
}
```

## YAML front matter

YAML front matter in a skill file is optional. When present, it is preserved verbatim through the build. At install time, the manifest's `name`, `description`, and any per-adapter extras are merged on top of the author's front matter.

```markdown
---
description: Guidelines for reviewing code changes
globs: "**/*.ts"
---

# Code Review

When reviewing code, follow these guidelines...
```

## Example

A "code-review" skill (`skills/code-review/SKILL.md`):

```markdown
---
description: Code review guidelines for TypeScript projects
---

# Code Review

## Structure
- Check that new files are placed in the correct directory.
- Verify imports are sorted and unused imports are removed.
- Confirm naming conventions match the project style.

## Logic
- Look for off-by-one errors in loops and array access.
- Verify error handling covers all failure paths.
- Check that async operations are awaited.
- Confirm discriminated unions are exhaustively matched.

## Testing
- Every new public function should have a corresponding test.
- Edge cases (empty input, null, boundary values) should be covered.
- Tests should not depend on execution order.

## Style
- Prefer `const` over `let` when the binding is never reassigned.
- Use early returns to reduce nesting.
- Do not comment obvious code.
```

## When to use skills

Skills are **passive knowledge** -- they inform how the assistant thinks and works but do not define who it is or what the user can invoke. Use skills for:

- Coding standards and conventions
- Review checklists
- Domain-specific guidelines (API design, security practices, accessibility)
- Framework best practices

Use [agents](/docs/learn/agents) when you need to define a persona with a specific role and behavior. Use [commands](/docs/learn/commands) when you need a user-invokable workflow that performs a specific task.

## Further reading

- [Agent Skills specification](https://agentskills.io/specification)
- [Manifest Schema](/specification/manifest) -- the `skills` field in `facet.json`
- [Getting Started](/guides) -- step-by-step guide to writing a skill
