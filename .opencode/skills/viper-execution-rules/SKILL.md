---
bundle:
  - viper
  - facet-design
name: viper-execution-rules
description: Rules and constraints for executing VIPER plans
---

# VIPER Plan Execution

This skill describes how to execute plans that follow the VIPER step model. It covers loading plans, creating TODOs, and the step execution protocol.

## Loading a Plan

When executing a plan (from a file or inline):

1. Read the plan fully before doing anything
2. Look for the `## Step Types` legend — it defines how each step type must be executed
3. Create TODOs from the step headings

## TODO Creation Rules

**Create exactly ONE TODO item per `### Step <N> - <Type>: <Description>` heading in the plan.**

- The TODO content MUST match the step heading: `<Type>: <Description>`
- NEVER combine steps into a single TODO
- NEVER skip steps
- Each TODO MUST maps to exactly one step heading
- You MUST NOT include the step number in the TODO content — only the type and description

### Example

```
CORRECT:
- Explore: Understand the widget registry       [in_progress]
- Propose: Add FooWidget to the registry         [pending]
- Implement: Add FooWidget to the registry       [pending]
- Verify: Lint and test the widget registry      [pending]

WRONG:
- Explore + Propose: Widget registry             [in_progress]
- Implement and Verify: FooWidget                [pending]
```

## Step Execution Protocol

Before executing ANY step, check its type prefix and follow the corresponding rules:

### Explore Steps (READ-ONLY)

1. Read files, search the codebase, investigate broadly
2. **DO NOT write, edit, or create ANY files**
3. Summarize findings — these inform subsequent Propose or Review steps
4. Mark complete and proceed to the next step

### Propose Steps (READ-ONLY + USER GATE)

1. Read the relevant files mentioned in the step
2. Show the user the current code and your intended changes
3. Use `mcp_question` to ask for explicit approval
4. **DO NOT write, edit, or create ANY files during a Propose step**
5. **DO NOT proceed to the next step until the user approves**

If the user rejects or requests changes, revise the proposal and ask again.

### Implement Steps (WRITE)

1. If a preceding Propose step exists for this change, it MUST have explicit user approval before proceeding
2. Make the code changes described in the step (or in the approved proposal)
3. Do not add, remove, or modify anything beyond what the step specifies

### Review Steps (READ-ONLY + USER GATE)

1. Analyze what was done or found — read code, examine changes, assess quality
2. Present your findings and analysis to the user
3. Use `mcp_question` to ask for feedback before proceeding
4. **DO NOT write, edit, or create ANY files during a Review step**
5. **DO NOT proceed to the next step until the user responds**

If the user has concerns, address them before moving on.

### Verify Steps (CHECK)

1. Run the verification commands specified in the step (lint, tests, type checks, syntax checks)
2. If ALL checks pass → mark complete, proceed to the next step
3. If ANY check fails → **STOP immediately**, report the failure to the user, and wait for instructions

## Hard Rule Enforcement

During execution, enforce these constraints:

1. **Explore → Propose before Implement**: If the current step is Implement and the most recent non-Implement step was Explore, STOP — this violates the hard rule. There must be a Propose (or Review) between Explore and Implement.
2. **Verify after Implement**: If the current step is Explore, Propose, or Review, and there are preceding Implement steps without a Verify between them, STOP — the plan is malformed.

If a hard rule violation is detected, notify the user and do not proceed.

## Execution Order

Steps MUST be executed in the order they appear in the plan. The general flow is:

```
Explore  →  Propose  →  Implement  →  Verify
              ↑              ↓
              └── Review ────┘
```

But the exact sequence depends on the plan. Follow document order.

## General Rules

- Mark each TODO as `in_progress` when you start it, `completed` when done
- Only have ONE TODO `in_progress` at a time
- If you encounter something unexpected or ambiguous, STOP and ask the user
- Do not go beyond what the plan specifies — if something seems missing, ask the user
