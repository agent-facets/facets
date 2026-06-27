> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## Step Types

- **Verify** → CHECK. Run automated checks (tests, lint, type checks).
  If all checks pass, proceed. If anything fails, STOP and notify the user.
- **Implement** → WRITE. Make code changes — create, edit, or delete files.
- **Propose** → READ-ONLY + USER GATE. Present intended changes in your message text first,
  then ask for approval using the `question` tool with a short prompt (Approve / Reject / Request changes).
  Never put details in the question — the question is just the gate. Do not write anything.
- **Explore** → READ-ONLY. Read files, search the codebase, investigate broadly.
  No writes allowed. Use this to understand the problem space before acting.
- **Review** → READ-ONLY + USER GATE. Present findings and analysis in your message text first,
  then ask for feedback using the `question` tool with a short prompt.
  Never put details in the question — the question is just the gate.

## 1. Adapter package — Research

- [x] 1.1 Explore: the codex adapter (`packages/adapters/codex`) — `src/index.ts` (per-asset-type branch + helpers), `package.json`, `tsdown.config.ts`, `tsconfig.json`, `turbo.json`, `sst-env.d.ts`, and its test suite — as the scaffold template.
- [x] 1.2 Explore: the adapter SDK surface (`@agent-facets/adapter`) on this branch — `defineAdapter`, `installAssetFile`/`readAssetFile`/`deleteAssetFile` return types, `Adapter` contract (`Promise<void>`), and `ValidationError`.
- [x] 1.3 Explore: OpenClaw's asset model and skill-loading roots (README + docs.openclaw.ai/tools/skills) to confirm `.agents/skills` layout and the single-line front-matter constraint.
- [x] 1.4 Propose: the OpenClaw adapter design (D1 map-to-skill, D2 `.agents` roots, D3 flat metadata).

## 2. Adapter package — Implementation

- [x] 2.1 Implement: scaffold `packages/adapters/openclaw` — `package.json` (`@agent-facets/adapter-openclaw`, 0.1.0), `tsdown.config.ts`, `tsconfig.json`, `turbo.json`, `sst-env.d.ts`, `CHANGELOG.md`.
- [x] 2.2 Implement: `src/index.ts` — `defineAdapter({ name: 'openclaw', supportsInstall: true })` with flat arktype schema, nested-value rejection (`assertFlatMetadata`), per-asset-type front-matter defaults (`withAssetDefaults`), and `.agents`-rooted path resolution.
- [x] 2.3 Implement: `src/__tests__/adapter.test.ts` based on the codex suite — identity, metadata accept/reject (incl. nested-object + array rejection), skill/command/agent round-trips per scope, user-scope base dirs, system-scope throw, idempotency.
- [x] 2.4 Verify: `bun test`, `bun run build`, `bun run types` in `packages/adapters/openclaw`.

## 3. Registration + tests + docs — Implementation

- [x] 3.1 Implement: add `openclaw` to `FIRST_PARTY_ADAPTERS` (`supportsInstall: true`) and to the `BUILTIN_ALIASES` map + doc comment.
- [x] 3.2 Implement: update registration tests — engine `specifier.test.ts` and cli `adapter-specifier.test.ts` (new alias case + built-in-name count), and the install-picker multi-select navigation + "lists all" assertions.
- [x] 3.3 Implement: `bun install` to link the workspace package; add a changeset.
- [x] 3.4 Implement: docs — `docs/guides/install-facets.md` table row and `docs/cli/adapters/install.md` bullet; update the `adapter__sdk` spec Purpose example list.
- [x] 3.5 Verify: run `bun check` across the monorepo.
