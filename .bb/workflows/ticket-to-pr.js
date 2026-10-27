export const meta = {
  name: "ticket-to-pr",
  description:
    "Qualify one low-risk ticket, implement it with one writer, verify the change, and prepare a human-gated draft-PR handoff.",
  inputSchema: {
    type: "object",
    required: ["ticket"],
    additionalProperties: false,
    properties: {
      ticket: {
        type: "object",
        required: ["id", "title", "description", "acceptanceCriteria", "risk"],
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
          acceptanceCriteria: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
          risk: { enum: ["low", "medium", "high"] },
          sourceUrl: { type: "string", minLength: 1, nullable: true },
        },
      },
    },
  },
  outputSchema: {
    type: "object",
    required: [
      "status",
      "ticketId",
      "summary",
      "validationCommand",
      "finalValidationPassed",
      "verifiedFindings",
      "prTitle",
      "prBody",
    ],
    additionalProperties: false,
    properties: {
      status: { enum: ["rejected", "blocked", "ready-for-draft-pr"] },
      ticketId: { type: "string" },
      summary: { type: "string" },
      validationCommand: { type: "string" },
      finalValidationPassed: { type: "boolean" },
      verifiedFindings: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "severity", "file", "line", "summary", "evidence", "suggestedFix"],
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            severity: { enum: ["critical", "high", "medium", "low"] },
            file: { type: "string" },
            line: { type: "integer", minimum: 1, nullable: true },
            summary: { type: "string" },
            evidence: { type: "string" },
            suggestedFix: { type: "string" },
          },
        },
      },
      prTitle: { type: "string", nullable: true },
      prBody: { type: "string", nullable: true },
    },
  },
  phases: [
    { title: "Qualify", detail: "Confirm the ticket and worktree meet the Phase 1 contract." },
    { title: "Plan", detail: "Produce a bounded implementation and validation plan." },
    { title: "Implement", detail: "Implement with one writer and run focused checks." },
    { title: "Validate", detail: "Run the repository-wide quality gate." },
    { title: "Review", detail: "Review the actual diff from three independent perspectives." },
    { title: "Verify", detail: "Adversarially verify proposed findings." },
    { title: "Repair", detail: "Repair only verified defects and failed validation." },
    { title: "Final validation", detail: "Re-run the repository-wide quality gate." },
    { title: "PR handoff", detail: "Prepare draft-PR content for human review." },
  ],
};

const ticket = args.ticket;
const validationCommand = "bun check";

const emptyResult = (status, summary) => ({
  status,
  ticketId: ticket.id,
  summary,
  validationCommand,
  finalValidationPassed: false,
  verifiedFindings: [],
  prTitle: null,
  prBody: null,
});

const findingSchema = {
  type: "object",
  required: ["id", "severity", "file", "line", "summary", "evidence", "suggestedFix"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    severity: { enum: ["critical", "high", "medium", "low"] },
    file: { type: "string" },
    line: { type: "integer", minimum: 1, nullable: true },
    summary: { type: "string" },
    evidence: { type: "string" },
    suggestedFix: { type: "string" },
  },
};

const qualification = await agent(
  `Use the intake-ticket skill to qualify this ticket for the Phase 1 factory.

Ticket:
${JSON.stringify(ticket, null, 2)}

Inspect repository instructions, Git status, and the workspace environment without editing. Phase 1 requires an isolated worktree and accepts only low-risk work. Return the requested structured decision.`,
  {
    label: `qualify:${ticket.id}`,
    phase: "Qualify",
    schema: {
      type: "object",
      required: ["eligible", "reason", "normalizedGoal", "acceptanceCriteria", "risk", "affectedAreas"],
      additionalProperties: false,
      properties: {
        eligible: { type: "boolean" },
        reason: { type: "string" },
        normalizedGoal: { type: "string" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        risk: { enum: ["low", "medium", "high"] },
        affectedAreas: { type: "array", items: { type: "string" } },
      },
    },
  },
);

if (!qualification.eligible) {
  log(`Ticket ${ticket.id} was rejected before edits: ${qualification.reason}`);
  return emptyResult("rejected", qualification.reason);
}

const plan = await agent(
  `Plan the accepted ticket below. Remain read-only. Read all applicable AGENTS.md files and inspect the implementation and tests. Keep the plan small enough for one writer.

Ticket:
${JSON.stringify(ticket, null, 2)}

Qualification:
${JSON.stringify(qualification, null, 2)}

Final repository gate: ${validationCommand}`,
  {
    label: `plan:${ticket.id}`,
    phase: "Plan",
    schema: {
      type: "object",
      required: ["goal", "steps", "expectedFiles", "targetedTests", "risks"],
      additionalProperties: false,
      properties: {
        goal: { type: "string" },
        steps: { type: "array", minItems: 1, items: { type: "string" } },
        expectedFiles: { type: "array", items: { type: "string" } },
        targetedTests: { type: "array", minItems: 1, items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
      },
    },
  },
);

const implementation = await agent(
  `Use the implement-ticket skill as the sole writer. Implement only this accepted ticket and run the focused checks from the plan. Do not push, publish, merge, or release.

Ticket:
${JSON.stringify(ticket, null, 2)}

Qualification:
${JSON.stringify(qualification, null, 2)}

Plan:
${JSON.stringify(plan, null, 2)}`,
  {
    label: `implement:${ticket.id}`,
    phase: "Implement",
    schema: {
      type: "object",
      required: ["status", "summary", "filesChanged", "validations", "blockers"],
      additionalProperties: false,
      properties: {
        status: { enum: ["completed", "blocked"] },
        summary: { type: "string" },
        filesChanged: { type: "array", items: { type: "string" } },
        validations: {
          type: "array",
          items: {
            type: "object",
            required: ["command", "ok", "summary"],
            additionalProperties: false,
            properties: {
              command: { type: "string" },
              ok: { type: "boolean" },
              summary: { type: "string" },
            },
          },
        },
        blockers: { type: "array", items: { type: "string" } },
      },
    },
  },
);

if (implementation.status === "blocked") {
  return emptyResult("blocked", implementation.blockers.join("; ") || implementation.summary);
}

const initialValidation = await agent(
  `Run exactly this repository validation command in the current workspace: ${validationCommand}

Do not edit files and do not substitute a weaker command. Report the observed exit result and concise failures.`,
  {
    label: `validate:${ticket.id}`,
    phase: "Validate",
    schema: {
      type: "object",
      required: ["ok", "command", "summary", "failures"],
      additionalProperties: false,
      properties: {
        ok: { type: "boolean" },
        command: { type: "string" },
        summary: { type: "string" },
        failures: { type: "array", items: { type: "string" } },
      },
    },
  },
);

const reviewDimensions = [
  {
    key: "correctness",
    instruction: "Check behavior, edge cases, regressions, and every acceptance criterion.",
  },
  {
    key: "architecture",
    instruction: "Check package boundaries, runtimes, result-value error contracts, and applicable AGENTS.md rules.",
  },
  {
    key: "tests",
    instruction: "Check that tests genuinely prove changed behavior and that important failure paths are covered.",
  },
];

const verifiedByDimension = await pipeline(
  reviewDimensions,
  (dimension) =>
    agent(
      `Use the verify-change skill. Remain read-only and review the actual diff for the ${dimension.key} dimension.

${dimension.instruction}

Ticket:
${JSON.stringify(ticket, null, 2)}

Plan:
${JSON.stringify(plan, null, 2)}

Implementation report:
${JSON.stringify(implementation, null, 2)}

Initial repository validation:
${JSON.stringify(initialValidation, null, 2)}

Return only actionable defects introduced by this change.`,
      {
        label: `review:${dimension.key}`,
        phase: "Review",
        schema: {
          type: "object",
          required: ["findings"],
          additionalProperties: false,
          properties: {
            findings: { type: "array", items: findingSchema },
          },
        },
      },
    ),
  (review, dimension) =>
    agent(
      `Use the verify-change skill to adversarially verify this ${dimension.key} review. Remain read-only. Attempt to refute every finding against the actual diff, source, tests, and repository instructions. Keep only findings that survive.

Ticket:
${JSON.stringify(ticket, null, 2)}

Proposed review:
${JSON.stringify(review, null, 2)}`,
      {
        label: `verify:${dimension.key}`,
        phase: "Verify",
        schema: {
          type: "object",
          required: ["verifiedFindings", "rejectedCount", "summary"],
          additionalProperties: false,
          properties: {
            verifiedFindings: { type: "array", items: findingSchema },
            rejectedCount: { type: "integer", minimum: 0 },
            summary: { type: "string" },
          },
        },
      },
    ),
);

const verifiedFindings = verifiedByDimension
  .filter(Boolean)
  .flatMap((result) => result.verifiedFindings);

const needsRepair = !initialValidation.ok || verifiedFindings.length > 0;

if (needsRepair) {
  const repair = await agent(
    `Use the implement-ticket skill as the sole repair writer. Repair only the verified findings and observed validation failures below. Preserve the accepted scope, add or adjust focused tests when needed, and run targeted checks. Do not push, publish, merge, or release.

Ticket:
${JSON.stringify(ticket, null, 2)}

Initial validation:
${JSON.stringify(initialValidation, null, 2)}

Verified findings:
${JSON.stringify(verifiedFindings, null, 2)}`,
    {
      label: `repair:${ticket.id}`,
      phase: "Repair",
      schema: {
        type: "object",
        required: ["status", "summary", "filesChanged", "validations", "blockers"],
        additionalProperties: false,
        properties: {
          status: { enum: ["completed", "blocked"] },
          summary: { type: "string" },
          filesChanged: { type: "array", items: { type: "string" } },
          validations: {
            type: "array",
            items: {
              type: "object",
              required: ["command", "ok", "summary"],
              additionalProperties: false,
              properties: {
                command: { type: "string" },
                ok: { type: "boolean" },
                summary: { type: "string" },
              },
            },
          },
          blockers: { type: "array", items: { type: "string" } },
        },
      },
    },
  );
  if (repair.status === "blocked") {
    return {
      ...emptyResult(
        "blocked",
        repair.blockers.join("; ") || repair.summary,
      ),
      verifiedFindings,
    };
  }
} else {
  log("No verified findings or validation failures require a repair pass.");
}

const finalValidation = await agent(
  `Run exactly this repository validation command in the current workspace: ${validationCommand}

Do not edit files and do not substitute a weaker command. Report the observed exit result and concise failures.`,
  {
    label: `final-validation:${ticket.id}`,
    phase: "Final validation",
    schema: {
      type: "object",
      required: ["ok", "command", "summary", "failures"],
      additionalProperties: false,
      properties: {
        ok: { type: "boolean" },
        command: { type: "string" },
        summary: { type: "string" },
        failures: { type: "array", items: { type: "string" } },
      },
    },
  },
);

if (!finalValidation.ok) {
  return {
    ...emptyResult("blocked", finalValidation.summary),
    verifiedFindings,
  };
}

const handoff = await agent(
  `Use the prepare-pr skill to prepare a draft pull-request handoff for this validated change. Remain read-only and do not commit, push, publish, mark ready, merge, or release.

Ticket:
${JSON.stringify(ticket, null, 2)}

Plan:
${JSON.stringify(plan, null, 2)}

Implementation report:
${JSON.stringify(implementation, null, 2)}

Verified findings repaired:
${JSON.stringify(verifiedFindings, null, 2)}

Final validation:
${JSON.stringify(finalValidation, null, 2)}`,
  {
    label: `pr-handoff:${ticket.id}`,
    phase: "PR handoff",
    schema: {
      type: "object",
      required: ["title", "body", "summary"],
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
);

return {
  status: "ready-for-draft-pr",
  ticketId: ticket.id,
  summary: handoff.summary,
  validationCommand,
  finalValidationPassed: true,
  verifiedFindings,
  prTitle: handoff.title,
  prBody: handoff.body,
};
