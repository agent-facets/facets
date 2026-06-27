## Context

OpenClaw is a personal AI assistant (Pi agent runtime) configured at
`~/.openclaw/openclaw.json` with an agent workspace at `~/.openclaw/workspace`.
It is **skill-driven**: the only file-based asset surface it loads is the skill
(`SKILL.md`, AgentSkills/agentskills.io front-matter). It discovers skills from
several roots, highest precedence first: `<workspace>/skills`,
`<workspace>/.agents/skills`, `~/.agents/skills`, `~/.openclaw/skills`, bundled,
then extra dirs.

The codex adapter is the precedent this change follows. Codex also has an asset
type whose native home is not markdown — its *agents* are TOML under
`.codex/agents/<name>.toml`, while its skills/commands are markdown under the
cross-tool `.agents/` root. Codex solves this by branching on `assetType` in
`installAsset/readAsset/deleteAsset` and using dedicated helpers for the
odd-format type. Codex shipped as pure conformance: no new OpenSpec requirement,
listed only as an example adapter in `adapter__sdk`.

## Goals / Non-goals

- **Goal**: a first-party OpenClaw adapter that materializes `skill`, `command`,
  and `agent` assets into a layout OpenClaw discovers natively, conforming to the
  existing adapter capabilities.
- **Non-goal**: mutating the shared `openclaw.json` `agents.list[]`; modeling the
  nested `metadata.openclaw` gating block; ClawHub integration. (See proposal.)

## Decisions

### D1 — Map all three asset types onto `SKILL.md`

OpenClaw has no on-disk convention for agents (config-array entries) or commands
(slash commands derived from a skill). The skill is the only file surface it
loads. The adapter therefore writes every asset type as a `SKILL.md`, branching
only on the front-matter defaults applied:

- `command` → defaults `user-invocable: true` + `disable-model-invocation: true`
  (a pure slash command kept out of the model prompt) unless the facet overrides.
- `agent` → installed as a skill verbatim (a facet "agent" surfaces as an
  OpenClaw skill).
- `skill` → installed verbatim.

This is the codex *pattern* (branch on `assetType`) applied to OpenClaw's
reality, where the branch lives in metadata defaults rather than file format
because OpenClaw needs no second format. Alternatives considered and rejected for
v1: writing agents into `openclaw.json` `agents.list[]` (mutates shared user
config); hard-failing on `agent` assets (a facet bundling an agent would fail to
install).

### D2 — Scope → `.agents` roots

`user` scope writes under `~/.agents` and `project` scope under `<cwd>/.agents`
(both then `/skills/<name>/SKILL.md`). `~/.agents/skills` and
`<workspace>/.agents/skills` are OpenClaw's documented "personal/project agent
skills" roots, and they are exactly where the codex adapter writes skills — so
the two first-party adapters stay byte-consistent and OpenClaw discovers the
output natively. `system` scope throws, matching codex/opencode/claude-code.

### D3 — Flat metadata only

OpenClaw's front-matter parser supports single-line scalar keys only, and the
shared `installAssetFile` helper serializes metadata with `yaml.stringify`
(multi-line for nested objects). `buildAssetMetadata` validates a flat arktype
schema of OpenClaw/AgentSkills keys (`name`, `description`, `user-invocable`,
`disable-model-invocation`, `command-dispatch`, `command-tool`,
`command-arg-mode`, `homepage`, `os`) and additionally rejects any non-scalar
value (nested object/array) up front, so the serializer can never emit
front-matter OpenClaw fails to parse.

## Risks

- **Asset-name collision across types.** Because skill/command/agent all map to
  `skills/<name>/SKILL.md`, two same-named assets of different types in one facet
  would collide. Facet asset names are facet-namespaced (e.g.
  `viper-plans/planning`), so this is unlikely; documented as a known edge.
- **Agent semantics.** A facet "agent" becomes an OpenClaw skill, not a native
  OpenClaw agent. This is an intentional v1 simplification (D1).

## Documentation impact (Article III)

- `docs/guides/install-facets.md` — first-party adapter table gains an `openclaw`
  row (`@agent-facets/adapter-openclaw`).
- `docs/cli/adapters/install.md` — built-in adapter list gains an `openclaw`
  bullet.

No other user-facing docs enumerate first-party adapters. No spec requirement
changes; the `adapter__sdk` Purpose example list adds "OpenClaw" as a routine
maintenance edit.
