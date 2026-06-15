---
title: "Facet Manifest – facet.json"
sidebarTitle: Facet Manifest
tag: facet.json
description: "The manifest format schema -- fields, types, and constraints."
---

The facet manifest (`facet.json`) is the source of truth for a facet's identity and the text assets it contains. This page defines every field in the manifest schema and is the canonical reference for the facet name grammar.

## Example

```json
{
  "name": "acme-dev",
  "version": "1.0.0",
  "description": "Acme org developer toolkit",
  "author": "acme-org",
  "skills": ["code-standards", "pr-template"],
  "agents": {
    "reviewer": {
      "description": "Org code reviewer",
      "prompt": { "file": "agents/reviewer.md" },
      "adapters": {
        "opencode": {
          "tools": { "grep": true, "bash": true }
        }
      }
    }
  },
  "commands": {
    "review": {
      "description": "Run a code review",
      "prompt": { "file": "commands/review.md" }
    }
  }
}
```

## Identity

| Field         | Required | Type   | Description                   |
| ------------- | -------- | ------ | ----------------------------- |
| `name`        | Yes      | string | Facet identity. An unscoped name (`cowsay`) or a scoped name (`@scope/name`). See [Schema Constraints](#schema-constraints). |
| `version`     | Yes      | string | Semver version string.        |
| `description` | No       | string | Human-readable description.   |
| `author`      | No       | string | Author name or identifier.    |

The `name` and `version` fields MUST be present. A manifest missing either field MUST be rejected. The `name` MUST be a valid facet identity: an unscoped name (`<slug>`) or a scoped name (`@<scope>/<slug>`). Asset names (skills, agents, commands) are validated independently as local kebab-case identifiers and are never scoped.

Consumers MUST tolerate unrecognized top-level fields. Unknown fields MUST be ignored  -- not rejected.

### Facet Name Grammar

A facet identity is one of exactly two forms:

- **Unscoped:** a single slug, e.g. `cowsay`.
- **Scoped:** `@<scope>/<slug>`, where both the scope and the base name are slugs, e.g. `@julian/cowsay`.

Every slug component (the unscoped name, a scope, and a scoped base name) MUST satisfy the same grammar:

- It MUST be at least 2 and at most 64 characters long.
- It MUST start with a lowercase ASCII letter (`a`-`z`).
- It MUST end with a lowercase ASCII letter or ASCII digit.
- It MUST contain only lowercase ASCII letters, ASCII digits, and hyphens (`-`).
- It MUST NOT contain consecutive hyphens.

Names are validated, never normalized. Uppercase letters, non-ASCII characters, underscores, dots, spaces, and other characters outside the grammar are rejected rather than rewritten.

| Valid          | Invalid             | Why invalid                          |
| -------------- | ------------------- | ------------------------------------ |
| `ab`           | `a`                 | shorter than 2 characters            |
| `cowsay`       | `Cowsay`            | uppercase letters                    |
| `admin-tester` | `1abc`              | does not start with a letter         |
| `apple-b34r`   | `abc-`              | ends with a hyphen                   |
| `@julian/cowsay` | `abc--def`        | consecutive hyphens                  |
| `@acme/deploy-tools` | `abc_def`       | underscore is not allowed            |

The following scoped shapes are rejected: a bare scope (`@scope`), a missing scope (`@/name`), a missing name (`@scope/`), extra path depth (`@scope/name/extra`), and the legacy un-prefixed form (`scope/name`).

## Text Assets

Text assets are the locally authored content included in the facet.

| Field      | Required | Type                              | Description                                                                  |
| ---------- | -------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `skills`   | No       | array of strings                  | Skill names. Each corresponds to a file in the facet.                        |
| `agents`   | No       | map of string → agent descriptor  | Agent name → agent descriptor (description, prompt, adapter config).         |
| `commands` | No       | map of string → command descriptor| Command name → command descriptor (description, prompt).                     |

A facet MUST have at least one locally authored text asset. A manifest with no text assets MUST be rejected.

### Agent Descriptor

| Field         | Required | Type                          | Description                                                            |
| ------------- | -------- | ----------------------------- | ---------------------------------------------------------------------- |
| `description` | No       | string                        | Human-readable description of the agent.                               |
| `prompt`      | Yes      | string or `{file: path}`       | The agent's prompt content or a reference to it.              |
| `adapters`   | No       | map of string → adapter config | Adapter name → adapter-specific agent configuration.                 |

The `prompt` field MUST be present. It MAY be:
- A string containing the prompt text directly
- An object with a `file` key containing a path relative to the facet root

The `adapters` section is OPTIONAL. It contains adapter-specific configuration (tool access, permissions, model preferences) keyed by adapter name. Each installed adapter validates its own metadata schema at build time. Unknown adapters produce a warning. Invalid metadata for an installed adapter is a build error.

### Command Descriptor

| Field         | Required | Type                          | Description                                                            |
| ------------- | -------- | ----------------------------- | ---------------------------------------------------------------------- |
| `description` | No       | string                        | Human-readable description of the command.                             |
| `prompt`      | Yes      | string or `{file: path}`       | The command's prompt content or a reference to it.            |

The `prompt` field follows the same rules as the agent descriptor's `prompt`.

## Schema Constraints

1. The `name` MUST be a valid facet identity (see [Facet Name Grammar](#facet-name-grammar)), and the `version` MUST be a semver string.
2. A facet MUST have at least one locally authored text asset.
3. The `@` character marks a scope (`@scope/name`) and also separates a name from a version when a facet is referenced elsewhere (`name@version`, `@scope/name@version`).
4. Consumers MUST tolerate unrecognized fields. Unknown fields MUST be ignored.
5. The manifest MUST NOT be modified by any tooling  -- it is immutable.
