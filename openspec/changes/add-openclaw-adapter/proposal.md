## Why

OpenClaw (https://github.com/openclaw/openclaw) is a fast-growing personal AI
assistant that runs the Pi agent runtime and is driven entirely by **skills**.
Facet authors who target OpenClaw have no first-party way to materialize their
skills, commands, and agents into the layout OpenClaw loads. Today the curated
install picker and the built-in adapter aliases stop at `claude-code`,
`opencode`, and `codex`; OpenClaw users must hand-place `SKILL.md` files.

Adding an OpenClaw adapter closes that gap. It is a **conforming implementation**
of the existing adapter capabilities (`adapter__sdk`, `adapter__assets`,
`adapter__management`) — exactly like the codex adapter, which shipped without
adding any new requirement. This change therefore introduces **no new
capability and no new requirement**; it adds one more first-party adapter
package plus the registration wiring and documentation that every first-party
adapter already carries.

## What Changes

- **New package `@agent-facets/adapter-openclaw`** (`packages/adapters/openclaw`)
  built on the same scaffold as `@agent-facets/adapter-codex`: `defineAdapter`,
  an arktype metadata schema, a `tsdown` self-contained bundle, and a unit-test
  suite modeled on the codex adapter's tests.
- **OpenClaw asset layout.** OpenClaw discovers skills under the cross-tool
  `.agents/skills` roots — the same `.agents/` convention the codex adapter
  writes to. The adapter SHALL place assets at:
  - `skill`   → `<base>/skills/<name>/SKILL.md`
  - `command` → `<base>/skills/<name>/SKILL.md` with front-matter defaults
    `user-invocable: true` and `disable-model-invocation: true`
  - `agent`   → `<base>/skills/<name>/SKILL.md` (mapped to a skill)

  where `<base>` is `~/.agents` for the user scope and `<cwd>/.agents` for the
  project scope; the `system` scope is unsupported and SHALL throw. OpenClaw has
  no on-disk convention for agents (they are `agents.list[]` entries in the
  shared `~/.openclaw/openclaw.json`) or for commands (they are slash commands
  *derived from* a skill), so the only file-based surface OpenClaw loads — the
  skill — is the single materialization target for all three asset types.
- **Single-line front-matter safety.** OpenClaw's front-matter parser accepts
  single-line scalar keys only. `buildAssetMetadata` SHALL reject any non-scalar
  (nested object or array) metadata value so the shared YAML serializer never
  emits multi-line front-matter OpenClaw cannot parse.
- **Registration wiring.** `openclaw` is added to the first-party adapter list
  (`supportsInstall: true`), to the built-in specifier alias map
  (`openclaw → @agent-facets/adapter-openclaw`), and to the existing
  registration tests (specifier resolution, built-in-name list, install picker).
- **Documentation.** The adapter is added to the install-facets guide table and
  the `facet adapter install` built-in list, alongside a changeset for release.

## Capabilities

### New Capabilities

None. All work fits within the existing `adapter` domain
(`adapter__sdk`, `adapter__assets`, `adapter__management`).

### Modified Capabilities

None. No requirement changes. The canonical example list in
`adapter__sdk` is updated to name OpenClaw among the example adapters
(routine maintenance, not a contract change), mirroring how Codex is listed.

## Impact

- **Affected areas**: new `packages/adapters/openclaw`; engine first-party list
  (`packages/engine/src/adapters/first-party.ts`) and specifier alias map
  (`packages/engine/src/sources/adapter/specifier.ts`); registration tests in
  `engine` and `cli`; the install-picker navigation test.
- **Dependencies**: none beyond the standard adapter devDependencies
  (`@agent-facets/adapter`, `arktype`, `tsdown`, `typescript`). The shared
  `yaml` serializer is inlined via the adapter SDK bundle, matching codex.
- **Tests**: a new adapter unit suite; updated built-in-name counts and a new
  alias case in the two specifier tests; an extra navigation step in the
  install-picker multi-select test.
- **Documentation**: `docs/guides/install-facets.md` (adapter table) and
  `docs/cli/adapters/install.md` (built-in list). These are the docs that
  enumerate first-party adapters and so must stay aligned per Article III.

## Non-goals

- **No `openclaw.json` mutation.** A facet `agent` asset is materialized as a
  skill, not merged into `agents.list[]` of the user's shared OpenClaw config.
  Writing to that shared mutable config is deferred (higher blast radius) and
  tracked as a possible follow-up.
- **No `metadata.openclaw` gating block.** The nested gating object
  (`requires.bins`, `os`, installer specs, etc.) is out of scope for v1 because
  it cannot be expressed as single-line front-matter through the shared YAML
  serializer.
- **No ClawHub publishing or `openclaw skills install` integration.** This change
  only materializes assets onto disk under the roots OpenClaw discovers.
- **No new adapter capability or requirement.** This is conformance work; the
  adapter contract is unchanged.
