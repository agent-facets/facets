Load the `viper-planning` skill for guidance on plan structure.

If the user provided a goal as arguments, use it. Otherwise, ask what they'd like to do. Only use the `question` tool if you need to ask multiple choice questions.

## Goal

$ARGUMENTS

## Workflow

1. Think, read, search, and explore to understand the problem
2. Ask the user clarifying questions — don't make large assumptions about intent
3. Compose VIPER steps that match the shape of the change (not every change needs all 5 types)
4. Display the plan to the user in full for review
5. Use the `question` tool to ask the user to approve the plan before implementation. If they request changes, update the plan and ask again until approved.
6. Once approved, persist the plan using the `viper-write-plan` tool
7. Do not try to implement — planning and execution are separate concerns

Tell the user they may use the `/viper-run` command to execute the newly created plan.
