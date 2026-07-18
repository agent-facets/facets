> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## 1. Enforce skill/command namespace — Research

- [ ] 1.1 Explore: Re-read `packages/protocol/src/build/detect-collisions.ts`, its callers (`packages/engine/src/build/pipeline.ts`, `packages/protocol/src/integrity/validate-archive.ts`), the existing collision tests (`packages/engine/src/__tests__/build-pipeline.test.ts`), and `docs/cli/authoring/build.mdx` to confirm the exact change surface and error shape.
- [ ] 1.2 Propose: Present the `detectNamingCollisions` change (skill↔command cross-namespace check, error message identifying both sections), the test inversion + additions, and the doc update. Gate before writing.

## 2. Enforce skill/command namespace — Implementation

- [ ] 2.1 Implement: Add a skill↔command shared-namespace check to `detectNamingCollisions` — a command name equal to any skill name (and vice versa) SHALL produce a collision error identifying the shared name and the skills/commands sections. Leave agents independent; match on exact name equality only.
- [ ] 2.2 Implement: Invert the `build-pipeline.test.ts` "skill and command sharing a name is allowed" test to expect a collision, and add regressions — skill/command clash rejected; skill/agent and command/agent still allowed; distinct nested names (command `space`, skill `space/spec`) not a collision.
- [ ] 2.3 Implement: Update `docs/cli/authoring/build.mdx` to state that skills and commands share one namespace (a name used by both fails the build), while agents remain independent.
- [ ] 2.4 Verify: Run `bun check` (lint, types, unit, e2e). If anything fails, STOP and notify the user.
