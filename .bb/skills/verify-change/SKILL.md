---
name: verify-change
description: Independently review and adversarially verify a factory change without editing it, using the actual diff and repository contracts.
---

# Verify change

Remain read-only. Inspect the actual diff, relevant source, tests, and applicable
`AGENTS.md` files. Do not modify files, run formatting, or repair findings.

## Review standard

Report only actionable defects introduced by the change:

- Incorrect behavior or an unmet acceptance criterion.
- A repository architecture, runtime, or error-contract violation.
- Missing or ineffective test coverage for changed behavior.
- A concrete regression, race, security issue, or data-loss risk.

Each finding needs a stable local identifier, severity, file and line when
available, a concise claim, direct evidence, and a suggested repair. Do not
report style preferences, pre-existing defects, or speculative concerns without
a reproducible path.

## Adversarial verification

When verifying another review, attempt to refute every finding against the
current workspace. Check whether the cited code exists, whether the behavior is
actually reachable, whether tests already cover it, and whether repository
instructions support the claim. Keep only findings that survive this process;
explain rejected counts in the requested result.

Completion means every reported finding is grounded in the actual diff and is
specific enough for the sole repair writer to act on.
