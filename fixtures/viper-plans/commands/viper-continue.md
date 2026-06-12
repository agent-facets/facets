Load the `viper-execution-rules` skill for guidance on the VIPER execution protocol.

Plan name (if provided): $ARGUMENTS

## Plan Detection

Identify the plan to execute using these rules, in order:

1. **Explicit argument**: If a plan name was provided as `$ARGUMENTS`, use it directly.

2. **History detection** (express path): Look back through the conversation for an **unambiguous** signal that a plan was persisted **this session**. Accept either:
   - A `viper-write-plan` **tool call** in the conversation history (it carries the exact plan name), OR
   - An **assistant message** stating a plan was just persisted, naming it (e.g. a closing handoff message like "Plan saved as **<name>**").

   Resolution:
   - **Exactly one plan name found** → take the **express path** (continue to Express Execution below).
   - **Multiple distinct plan names found**, OR a "persisted" message with **no resolvable plan name** (e.g. compaction dropped the tool call and the message is ambiguous) → **fail out**. Tell the user: "Multiple plans detected in this session — it's ambiguous which one to run. Please use `/viper-run` to select a plan, or pass a plan name: `/viper-continue <name>`." **Stop here.**

3. **No signal at all** (fresh agent, no persisted plan in history) → fall through to the **Full Selection Fallback** below.

## Express Execution

The user just approved this plan — don't make them re-read it. Keep the gate minimal.

1. **Load the plan**: Read `.opencode/plans/<name>/plan.md` fresh. If the `viper-read-plan` tool is available, use it. Otherwise, read the file directly with your file tools.

2. **Count the steps**: Count the `### Step` headings in the plan content.

3. **Single gate**: Tell the user which plan you found and how many steps it has, in one line. Then use the `question` tool with a short prompt:
   - **Run it** — Begin execution
   - **Show the full plan first** — Display the plan, then ask again
   - **Cancel** — Do not execute

4. **Execute**: On "Run it", follow the `viper-execution-rules` skill protocol:
   - Create one TODO per step heading
   - Execute steps in order following the VIPER protocol
   - Gate Propose and Review steps on user approval/feedback
   - Stop on Verify failures
   - Enforce hard rules (Explore→Propose before Implement, Verify after Implement)

## Full Selection Fallback

No plan was detected in conversation history. Fall back to the full selection flow:

1. **Discover plans**: If the `viper-list-plans` tool is available, use it. Otherwise, enumerate the subdirectories of `.opencode/plans/` with your file tools.

2. **Select a plan**:
   - If only one plan exists, auto-select it but confirm with the user using the `question` tool: "Found one plan: **<name>**. Review it?"
   - If multiple plans exist, use the `question` tool to let the user select which plan to review and execute:
      - Show the list of plan names for selection
      - Allow only one selection
   - If no plans exist, tell the user and suggest using `/viper-plan` to create one

3. **Load the plan**: Read `.opencode/plans/<name>/plan.md` fully. If the `viper-read-plan` tool is available, use it. Otherwise, read the file directly.

4. **Display the plan to the user**: Show the VIPER plan steps to the user

5. **Confirm execution**:
   - Use the `question` tool to ask the user to choose between: execute the plan, view the plan in full, or reject it
   - If they choose to view the plan, show the full content and ask again
   - If they reject the plan, stop execution and ask if they want to delete the plan file

6. **Execute**: Follow the viper-execution-rules skill protocol (same as Express Execution step 4).

## Cleanup

Once complete, ask the user if they want to delete the plan with the `question` tool using a simple yes/no binary.

If they answer yes: if the `viper-delete-plan` tool is available, use it. Otherwise, delete the `.opencode/plans/<name>/` directory directly with your file tools.
