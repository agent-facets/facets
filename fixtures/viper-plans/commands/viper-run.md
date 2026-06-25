Load the `viper-execution-rules` skill for guidance on the VIPER execution protocol.

Plan name (if provided): $ARGUMENTS

## Workflow

1. **Discover plans**: If the `viper-list-plans` tool is available, use it. Otherwise, enumerate the subdirectories of `.opencode/plans/` with your file tools.

2. **Select a plan**:
   - If a plan name was provided as an argument, use it (look for a plan directory with that name)
   - If only one plan exists, auto-select it but confirm with the user using the `question` tool: "Found one plan: **<name>**. Review it?"
   - If multiple plans exist, use the `question` tool to let the user select which plan to review and execute:
      - Show the list of plan names for selection
      - Allow only one selection
   - If no plans exist, tell the user and suggest using `/viper-plan` to create one

3. **Load the plan**: Read `.opencode/plans/<name>/plan.md` fully. If the `viper-read-plan` tool is available, use it. Otherwise, read the file directly with your file tools.

4. **Display the plan to the user**: Show the VIPER plan steps to the user

5. **Confirm execution**:
   - Use the `question` tool to ask the user to choose between: execute the plan, view the plan in full, or reject it
   - Do not provide any other options
   - If they choose to view the plan, show the full content of the plan file and then ask again if they want to execute it
   - If they reject the plan, stop execution and ask if they want to delete the plan file

6. **Execute**: Follow the viper-execution-rules skill protocol:
   - Create one TODO per step heading
   - Execute steps in order following the VIPER protocol
   - Gate Propose and Review steps on user approval/feedback
   - Stop on Verify failures
   - Enforce hard rules (Explore→Propose before Implement, Verify after Implement)

## Cleanup

Once complete, ask the user if they want to delete the plan with the `question` tool using a simple yes/no binary.

If they answer yes: if the `viper-delete-plan` tool is available, use it. Otherwise, recursively remove the entire `.opencode/plans/<name>/` directory and all of its contents with your file tools, leaving no orphaned files or empty directory behind.
