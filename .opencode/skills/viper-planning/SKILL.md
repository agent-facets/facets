---
bundle:
  - viper
  - facet-design
name: viper-planning
description: How to construct well-formed plans using the VIPER step model
---

# VIPER Plan Construction

This skill describes how to construct well-formed plans using the VIPER step model. VIPER gives plan authors five step types — **Verify**, **Implement**, **Propose**, **Explore**, **Review** — that can be composed flexibly to match the shape of each change.

## Step Types

Every plan MUST include a Step Types legend at the top so the executor can reference it. Copy this verbatim:

```
## Step Types

- **Verify** → CHECK. Run automated checks (tests, lint, type checks).
  If all checks pass, proceed. If anything fails, STOP and notify the user.
- **Implement** → WRITE. Make code changes — create, edit, or delete files.
- **Propose** → READ-ONLY + USER GATE. Show the user intended changes and ask for approval
  using the `question` tool. Do not write anything. Do not proceed until the user approves.
- **Explore** → READ-ONLY. Read files, search the codebase, investigate broadly.
  No writes allowed. Use this to understand the problem space before acting.
- **Review** → READ-ONLY + USER GATE. Analyze what was done or found, present findings
  to the user, and wait for feedback before proceeding.
```

## Hard Rules

Plan authors MUST follow these constraints when composing steps:

1. **Explore → Propose before Implement**: An Explore step MUST be followed by another Explore or a Propose step before any Implement step. Never go directly from Explore to Implement.
2. **Verify after Implement**: There MUST be at least one Verify step after any Implement step(s). Multiple Implements can batch before a single Verify, but you cannot end a plan or start a new Explore/Propose cycle without verifying what was implemented.
3. **Implement without Propose is allowed**: Not every Implement needs a preceding Propose. The plan author decides when user approval is needed based on the risk and complexity of the change.

## Step Naming Convention

Format: `### Step <N> - <Type>: <Description>`

Where `<Type>` is one of: `Explore`, `Propose`, `Implement`, `Review`, `Verify` and `<N>` is the step number.

Steps are executed in the order they appear in the plan.

## One Step = One TODO

**Every `### <Type>: <Description>` heading becomes exactly ONE TODO item during execution.** Sub-content within a step is description for that single TODO — it does NOT create separate TODOs. Every distinct action that should be tracked independently MUST be its own step heading.

## When to Use Each Step Type

| Step          | Use when...                                                                                    |
|---------------|------------------------------------------------------------------------------------------------|
| **Verify**    | You need to run automated checks — tests, lint, type checks, syntax validation                 |
| **Implement** | You're ready to write, edit, or delete files                                                   |
| **Propose**   | The change is non-trivial and the user should approve the approach before you write code       |
| **Explore**   | You need to read code, search for patterns, understand architecture before deciding what to do |
| **Review**    | You want to analyze work that was done (yours or existing), present findings, and get feedback |

## Example Patterns

### Pattern 1: Full cycle with user gate

A non-trivial change where the user should approve before implementation:

```
### Explore: Understand the widget registry
### Propose: Add FooWidget to the registry
### Implement: Add FooWidget to the registry
### Verify: Lint and test the widget registry
```

### Pattern 2: Batched implements with single verify

Multiple related mechanical changes that don't need individual approval:

```
### Explore: Find all deprecated API calls
### Propose: Replace deprecated API calls across 4 files
### Implement: Update api_client.rb
### Implement: Update webhook_handler.rb
### Implement: Update batch_processor.rb
### Implement: Update event_listener.rb
### Verify: Run full test suite for API layer
```

### Pattern 3: Research-heavy with review

Deep investigation before a targeted change:

```
### Explore: Map the authentication flow
### Explore: Identify all session timeout paths
### Review: Present findings on session handling gaps
### Propose: Fix session timeout in OAuth callback
### Implement: Fix session timeout in OAuth callback
### Verify: Run auth test suite
```

### Pattern 4: Implement without propose

A trivial/mechanical change where user approval isn't needed:

```
### Implement: Fix typo in error message
### Verify: Run lint check
```

## TODO Naming Convention

Each step's TODO content MUST match the step heading: `<Type>: <Description>`

NEVER combine multiple steps into one TODO.

## Common Mistakes

- **Explore directly to Implement**: Going from Explore to Implement without a Propose in between. Explore MUST lead to Explore or Propose before Implement.
- **Missing Verify after Implement**: Every Implement (or batch of Implements) MUST be followed by a Verify.
- **Bundled phases**: Writing multiple step types as sub-content within a single step heading. Each phase MUST be its own step.
- **Missing type prefix**: Writing "### Add FooWidget" without the Explore/Propose/Implement/Review/Verify type.
- **Missing legend**: The Step Types legend MUST be included in the plan itself.
