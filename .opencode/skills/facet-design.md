---
name: facet-design
description: Design guide for OpenCode capability facets - required for designing agents, skills, commands, and tools
---

# Facet Design Guide

Use this guide when designing new OpenCode capability facets or refactoring existing ones. It defines the responsibility of each resource type and how they compose.

## Resource Layering

Every facet is built from four resource types. Each has exactly one job:

| Resource    | Responsibility                          | Question it answers         |
|-------------|-----------------------------------------|-----------------------------|
| **Agent**   | Permission boundary, tool safety net    | "What CAN you do?"          |
| **Skill**   | Descriptive knowledge (lazy-loaded)     | "How to do X well"          |
| **Command** | Initiation + workflow (human-triggered) | "Start doing X"             |
| **Tool**    | Function (deterministic)                | "Do this mechanical thing"  |

### Agent

Agents define **what is allowed**, not what to do. They are the ONLY mechanism to gate tool access and permissions.

- A new agent MUST be justified by permission or tool access requirements that existing agents don't satisfy.
- Agents SHOULD be few and general-purpose (e.g., `plan`, `build`)
- Agent prompts SHOULD focus on identity and constraints. Workflow and expertise SHOULD live in commands and skills respectively. Single-purpose agents MAY inline these when the agent exists solely for one purpose.
- New facets SHOULD reuse existing agents before creating new ones

### Skill

Skills are **descriptive knowledge** — they describe how to do things well, but they don't do them.

- Skills MAY describe anything: workflows, processes, conventions, formats, best practices, patterns
- Skills MUST NOT force action — they inform, they don't initiate. That's a command's job.
- Skills MUST NOT enforce permissions — that's an agent's job
- Skills are available everywhere and SHOULD be treated as read-only knowledge repositories, lazy-loaded whenever needed
- Skills are the right choice when the knowledge applies regardless of which agent or command is active

### Command

Commands **do things**. They define actions and processes triggered by explicit user invocation (slash commands) — there is no other way to trigger them.

- Commands MUST define an action sequence, even if it's a single action
- Commands MAY set specific agents for execution
- Commands SHOULD handle precondition checks, resource discovery ("which plan?"), workflow sequencing, and verification
- Reusable expertise about how to do something well SHOULD be extracted into skills
- Commands orchestrate, skills inform.

### Tool

Tools are **functions** — a mechanical action agents can invoke.

- Tools SHOULD be as simple as possible: input → result
- Tools SHOULD be deterministic
- Tools SHOULD NOT encode workflow logic
- Tools MUST validate input structure using Zod schemas
- Tools MUST provide an accurate description of their function, so they can be invoked properly by agents

## Designing a Facet

### Breaking Down Concerns

Start by breaking down what your facet needs to provide into individual concerns. A concern is a distinct thing your facet needs to know, do, or restrict. There are three types:

- **Knowledge** — something the facet needs to know (conventions, formats, best practices)
- **Action** — something the facet needs to do (a user-triggered workflow, a mechanical operation)
- **Permission** — something the facet needs to restrict (read-only access, limited tool access)

For example, "I want to automate code review" breaks down into:
- "Kick off a review" → action
- "Reviews shouldn't modify anything" → permission
- "RSpec conventions should inform the review" → knowledge

Each concern maps to one resource. If a concern feels like it needs two, split it — you're probably looking at two concerns bundled together:

  ✗ "Planning needs to be safe and write a plan file"
  ► "Planning needs to be safe" → permission
  ► "Write a plan file" → action

### Mapping Concerns to Resources

Walk this tree for each concern. Each concern produces at most one resource — sometimes zero, if existing resources already cover it.

```text
            What is your concern type?
                       │
         ┌─────────────┼────────────────────────────────────┐
         ▼             ▼                                    ▼
     Knowledge       Action                             Permission
         │             │                                    │
         ▼             ▼                                    ▼
     ► Skill      ► Command                       Does an existing agent
                       │                        have the right permissions?
                       ▼                                    │
                Need determinism?                           │
                       │                       ┌────────────┼───────────────┐
              ┌────────┼────────┐              ▼            ▼               ▼
              ▼        ▼        ▼          Too broad    Too narrow       ✗ Yes,
             Yes     Maybe    ✗ No             │            │              reuse it
              │        │                       │            │
              ▼        ▼                       ▼            ▼
           ► New    ? Consider              ► New      ✗ I don't believe you
             tool     a tool                  agent
```

Once you've walked the tree for every concern, combine the resources you identified. That's your facet.

### Examples

**Review facet**

| Concern                             | Type       | Tree path               | Resource                    |
|-------------------------------------|------------|-------------------------|-----------------------------|
| Kick off a review                   | Action     | Action → No determinism | ► Command (`/review`)       |
| Reviews shouldn't modify anything   | Permission | Permission → reuse it   | ✗ Reuse (`plan`)            |
| RSpec conventions inform the review | Knowledge  | Knowledge               | ► Skill (`rspec-structure`) |

> [!NOTE]
> If the `plan` agent didn't exist, we'd have hit the "too broad" path for our Permission concern and make a new agent.

**Persistent plans facet**

| Concern                               | Type       | Tree path                | Resource                          |
|---------------------------------------|------------|--------------------------|-----------------------------------|
| User kicks off planning               | Action     | Action → No determinism  | ► Command (`/viper-plan`)         |
| User kicks off execution              | Action     | Action → No determinism  | ► Command (`/viper-run`)          |
| Persist plan to file from plan agent  | Action     | Action → Yes determinism | ► Tool (`viper-write-plan`)       |
| Planning needs restricted permissions | Permission | Permission → reuse it    | ✗ Reuse (`plan`)                  |
| How to structure a good plan          | Knowledge  | Knowledge                | ► Skill (`viper-planning`)        |
| How to execute with VIPER gates       | Knowledge  | Knowledge                | ► Skill (`viper-execution-rules`) |

### Watch Out For

- **Bloated concerns**: If a resource feels like it's doing two jobs, you have two concerns. Split them.
- **Unnecessary agents**: If you can't point to a permission gap, you don't need a new agent. Use a command.
- **Skills that force action**: Skills describe, they don't initiate. If your skill is dictating steps, it's a command.
