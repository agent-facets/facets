# Design: unify skill and command namespace

## Context

The facet artifact specification currently defines naming collisions per asset type: skills must be unique among skills, commands among commands, agents among agents, and cross-type duplicates are explicitly allowed. This was a reasonable default when every adapter mapped each asset type to its own directory. It breaks for tools that collapse skills and commands into one on-disk namespace — most notably Codex, which has no command concept and installs a command as a skill at `.agents/skills/<name>/SKILL.md`, the same path a skill of that name uses.

The observable failure (validated against a real Codex adapter + install pipeline): a facet with a skill and a command both named `plan` installs one over the other, reports a permanent "repaired" loop on every subsequent install, and deletes the surviving file when either asset is removed. The facet builds and publishes without error today, so the defect is discovered only at install time on one tool.

## Goals

- Make the invalid pairing impossible to produce: a facet that shares a name between a skill and a command fails at build and fails archive verification.
- Keep the rule adapter-agnostic and enforced once, in the protocol build validator, so every consumer (build, archive verification, publish verification) tightens together.
- Preserve the agent namespace as independent — agents do not collide with skills or commands on disk in the tools we target.

## Decisions

### D1 — Enforce at the protocol level, not per-adapter

A skill/command name clash is unresolvable on a shared-namespace tool without renaming. Rather than have each adapter detect and reject (or worse, disambiguate) the clash at install time, the facet contract itself forbids it. This makes portability correct by construction: a facet that passes build is installable on any conforming tool, including shared-namespace ones.

Rejected alternative — per-adapter path disambiguation (suffixes, alternate directories): leaves a residual injectivity hole (two distinct authored names could still map to one path), imposes migration cost on already-installed assets, and diverges layout per tool. This was discussed and rejected during PR review.

Rejected alternative — a runtime install-time guard in the engine (an adapter `resolvePath` hook plus an install preflight that fails on colliding paths). This was prototyped and works, but it detects the problem late (at install, per consumer) rather than preventing the invalid artifact, and it pushes an adapter-specific concern into the shared install pipeline. The protocol invariant supersedes it.

### D2 — Skills and commands share one namespace; agents stay separate

The shared namespace is exactly skills ∪ commands, because that is the set collapsed to one directory on the affected tools. Agents live in a distinct tree (e.g. Codex `.codex/agents/<name>.toml`) and do not collide, so an agent MAY continue to share a name with a skill or a command. The collision is defined on **exact** name equality; distinct nested names (command `space`, skill `space/spec`) are different names and do not collide.

### D3 — One enforcement point

`detectNamingCollisions` is already the single build validator for naming, consumed by the build pipeline and by archive verification. Adding the skill↔command check there tightens both paths, and publish verification inherits it because it applies the same archive-verification checks. No separate publishing spec change is required; the publishing spec already delegates to "the same checks a facet-compatible system applies to a `.facet` archive."

## Spec impact

- `authoring__facets` — the "Build detects naming collisions between local assets" requirement gains the skill/command shared-namespace rule; the "Skill and command share a name" scenario inverts from success to build failure. Skill/agent and command/agent scenarios stay as success.
- `protocol__integrity` — the archive-verification requirement's artifact-content-rules clause and its content-rule-violation scenario add the skill/command name-sharing case.

## Documentation impact (Article III)

- `docs/cli/authoring/build.mdx` states the collision check "Fails if the same name is used more than once within the same asset type." This MUST be updated to state that skills and commands share one namespace (a name used by both a skill and a command fails the build), while agents remain independent.
- `docs/alpha/onboarding.mdx` mentions cross-facet collisions as a post-alpha fast-follow; that is a different concern and is left unchanged.

## Migration / compatibility

An existing facet that today declares a skill and a command with the same name will begin to fail the build after this change. This is intended: such a facet was never installable correctly on shared-namespace tools. Authors resolve it by renaming one of the two assets. Already-built `.facet` artifacts containing the clash will fail archive verification and therefore fail publish verification — again intended, surfacing a previously-silent defect.

## Non-goals

Interactive prevention in `facet create` / `facet edit`, cross-facet collision detection, and any runtime install-time guard are out of scope (see proposal Non-goals). The build gate is the enforcement boundary for this change.
