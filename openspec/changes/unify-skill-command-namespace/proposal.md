## Why

Some coding tools install skills and commands into one shared on-disk namespace. Codex is the clearest case: it has no separate "command" concept, so a command is delivered as a skill at `.agents/skills/<name>/SKILL.md` — the exact path a skill of the same name uses. When a facet declares a skill and a command with the same name, they resolve to the same file: one clobbers the other at install, repeated installs ping-pong "repairs" between them, and removing either deletes the other's file.

Today the facet artifact specification explicitly permits this pairing — a skill and a command MAY share a name, and the build succeeds. That makes such a facet impossible to install correctly on Codex and silently lossy. This is a portability hole in the facet contract itself, not a single tool's bug: a facet that builds and publishes cleanly cannot be installed faithfully everywhere.

## What Changes

- Building a facet SHALL treat a skill and a command that share a name as a naming collision and fail the build with an error identifying the shared name and the sections involved.
- Skills and commands SHALL share a single name namespace within a facet: a command name MUST NOT equal any skill name, and a skill name MUST NOT equal any command name.
- Agents SHALL keep an independent namespace — an agent MAY still share a name with a skill or a command.
- Archive verification SHALL apply the tightened content rules, so a `.facet` whose inner content contains a skill/command name clash SHALL fail verification rather than being treated as trusted. Publish verification inherits this because it applies the same archive-verification checks.
- User-facing build documentation SHALL describe that skills and commands share one namespace.

## Non-goals

- This change will NOT introduce per-adapter path disambiguation, name suffixes, or per-tool layout divergence to let same-named skills and commands coexist. That approach was rejected for its residual injectivity hole, migration cost, and per-adapter divergence.
- This change will NOT alter the agent namespace — an agent MAY still share a name with a skill or a command.
- This change will NOT add interactive prevention in the `facet create` / `facet edit` wizards; the build gate catches the collision, and interactive prevention is a follow-up.
- This change will NOT add cross-facet collision detection (two facets each shipping the same asset name); that remains a separate post-alpha concern.
- This change will NOT add a runtime install-time guard; enforcement is at build and verification, so an invalid facet cannot be produced in the first place.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `authoring__facets`: Building a facet SHALL reject a skill and a command that share a name, treating skills and commands as one name namespace while leaving agents independent.
- `protocol__integrity`: Archive verification SHALL reject a built artifact whose inner content shares a name between a skill and a command, as part of the artifact content rules.

## Impact

- Protocol build validator `detectNamingCollisions` (`packages/protocol/src/build/detect-collisions.ts`) gains a skill↔command cross-namespace check. It is consumed by the build pipeline (`packages/engine/src/build/pipeline.ts`) and by archive verification (`packages/protocol/src/integrity/validate-archive.ts`), so both paths tighten from one change.
- Tests: invert `packages/engine/src/__tests__/build-pipeline.test.ts` ("skill and command sharing a name is allowed") and add regressions — skill/command clash rejected; skill/agent and command/agent still allowed; distinct nested names (command `space`, skill `space/spec`) unaffected.
- Documentation: `docs/cli/authoring/build.mdx` currently states the build "Fails if the same name is used more than once within the same asset type"; it SHALL be updated to state that skills and commands share one namespace. The `docs/alpha/onboarding.mdx` cross-facet collision note is unrelated and left as-is.
- Publishing behavior follows from the archive-verification change (publish verification applies the same checks); no separate publishing spec delta is required.
