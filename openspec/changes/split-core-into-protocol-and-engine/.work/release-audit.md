# Release Pipeline Audit — `core` References

Scope: identify every place the release pipeline and changeset configuration hardcode the package name `core` or `@agent-facets/core`, and verify that adding `@agent-facets/protocol` and `@agent-facets/engine` requires no script logic changes.

## 1. Direct `core` references

### `scripts/release/publish.ts`

| Line | Quoted | Purpose |
|------|--------|---------|
| 5 | `` * (e.g., `@agent-facets/core@0.3.0`). Parses the package name and `` | Docblock example tag. Illustrative only — not parsed. |

No code logic references `core`. Tag handling is fully delegated to `parseTag` from `scripts/lib/tags.ts`.

### `scripts/release/version.ts`

No direct `core` references.

### `scripts/release/tag.ts`

No direct mentions of the bare word `core` in code. The `SCOPED_TAG_PACKAGE_REGEX` (line 55) is `@agent-facets/<pkg>@` — package-name-agnostic across `[a-z0-9-]+`. Will match `protocol`, `engine`, etc. without modification.

### `scripts/release/seed-adapters.ts`

No direct `core` references. Selection uses generic predicates:

```ts
function isAdapterSeedTarget(pkg: { name: string; private?: boolean }): boolean {
  if (pkg.private) return false
  if (!pkg.name.startsWith('@agent-facets/')) return false
  if (pkg.name.startsWith('@agent-facets/cli-')) return false
  return true
}
```

`@agent-facets/protocol` will be picked up automatically. `@agent-facets/engine` is private (per the change's design), so it is correctly excluded by the `pkg.private` guard.

### `scripts/release/README.md`

| Line | Quoted | Purpose |
|------|--------|---------|
| 3 | `` Publishes `@agent-facets/core`, `@agent-facets/brand`, `@agent-facets/adapter`, `@agent-facets/adapter-*`, ... `` | Prose listing of packages this pipeline publishes. Documentation only — needs an update to mention `@agent-facets/protocol`. |

### `scripts/lib/changesets.ts`

| Line | Quoted | Purpose |
|------|--------|---------|
| 64 | `'@agent-facets/core': 1,` | Display ordering for the Version Packages PR body (used by `comparePackageOrder`). Determines that core appears just below `agent-facets` (CLI) and above `brand`. |
| 381 | `// Sub-lines: indented dependency entries like "  - @agent-facets/core@0.1.2"` | Comment example only. |

The `PACKAGE_ORDER` map at line 62-66 is the **only piece of presentation logic that hardcodes core**. It does not affect publishing correctness — it only sorts entries in the auto-generated PR. After the rename, `@agent-facets/core` will sort to "everyone else" (Number.MAX_SAFE_INTEGER), so it would visually drop to the bottom unless the entry is renamed to `@agent-facets/protocol`.

### `scripts/lib/tags.ts`

No direct `core` references.

### `scripts/lib/ci.ts`

No direct `core` references.

### `scripts/lib/npm.ts`

No direct `core` references.

### `scripts/lib/announce.ts`

No direct `core` references.

### `scripts/lib/constants.ts`

No direct `core` references.

### `scripts/lib/io/circleci.ts`

| Line | Quoted | Purpose |
|------|--------|---------|
| 21 | `` * `@agent-facets/core@1.0.0` fires only the `release` workflow. The `` | Docblock example tag. |
| 27 | `` * releases of `@agent-facets/core` and `@agent-facets/adapter` can `` | Docblock example explaining per-package serial group. |

Both are docs only — no code logic.

### `scripts/lib/test-helpers.ts`

| Line | Quoted | Purpose |
|------|--------|---------|
| 23 | `# @agent-facets/core` | Sample CHANGELOG.md fixture used by tests. Tests will need either renaming or treating as generic fixture. |

### Test files (`*.test.ts`)

Multiple uses of `@agent-facets/core` as test fixture data — not production logic. Files affected:

- `scripts/release/publish.test.ts` — many lines (22-240) use `@agent-facets/core@1.1.0` as a stand-in tag.
- `scripts/release/tag.test.ts` — many lines (56-257) use it as the test workspace package.
- `scripts/release/version.test.ts` — uses it as a workspace fixture.
- `scripts/lib/changesets.test.ts` — fixture in PR body / changelog rewrite tests.
- `scripts/lib/io/circleci.test.ts` — line 97-124 uses `@agent-facets/core@1.0.0` and the parsed `'core'` string as the package parameter (line 98, 107).
- `scripts/lib/npm.test.ts` — line 67-75 uses `agent-facets-core-0.6.4.tgz` as a tarball name fixture.
- `scripts/lib/prepack.test.ts` — uses `@my/core` (a fictional namespace, not `@agent-facets/core`). Not affected by this change.

These are fixtures. They continue to pass after the rename because the production code never reads `'core'` as a literal — but they document a shape that the rename does not invalidate. It's safe to leave them as-is, OR we can update them to use `@agent-facets/protocol` for clarity. **Recommendation: leave the test fixtures alone** to keep the PR diff minimal; they exercise the parser/regex agnostically.

### `.circleci/development/@config.yml` and `.circleci/release/@config.yml` (symlink)

| Line | Quoted | Purpose |
|------|--------|---------|
| 8 | `` # (so `@agent-facets/core@x` and `@agent-facets/adapter@y` releases can run `` | Comment explanation only. |

### `.circleci/AGENTS.md`

| Line | Quoted | Purpose |
|------|--------|---------|
| 91 | `(`core`, `adapter`, …)` | Prose example of two packages that release in parallel. |

### `.circleci/development/commands/run-check.yml`

| Line | Quoted | Purpose |
|------|--------|---------|
| 7 | `# over 4 GB when core + three adapter builds fan out simultaneously` | Comment about OOM behaviour. References "core" generically as the heavy build that combines with adapters. |

This comment will become stale after the split: the OOM-prone build is now `core` (which contains the build pipeline + edit context — still the heavy one) plus protocol (small) plus adapters. Worth updating prose, but no functional impact.

## 2. parseTag verification

- **File where parseTag lives**: `scripts/lib/tags.ts`
- **Function signature**:
  ```ts
  export function parseTag(tag: string): { name: string; version: string } | null
  ```
- **Implementation**:
  ```ts
  const scoped = tag.match(/^(@[^@]+)@(\d+\..+)$/)
  if (scoped?.[1] && scoped[2]) return { name: scoped[1], version: scoped[2] }

  const unscoped = tag.match(/^([^@]+)@(\d+\..+)$/)
  if (unscoped?.[1] && unscoped[2]) return { name: unscoped[1], version: unscoped[2] }

  return null
  ```

**Is it package-name-agnostic? YES.**

The two regexes encode only:
1. Scoped format: `@<scope>/<name>@<semver>` where the entire `@<scope>/<name>` is captured as the name.
2. Unscoped format: `<name>@<semver>`.

Neither regex enforces a specific scope or package name. Both `@agent-facets/protocol@0.1.0` and `@agent-facets/engine@0.1.0` parse cleanly:

- `parseTag('@agent-facets/protocol@0.1.0')` → `{ name: '@agent-facets/protocol', version: '0.1.0' }`
- `parseTag('@agent-facets/engine@0.1.0')` → `{ name: '@agent-facets/engine', version: '0.1.0' }`

`publish.ts` then calls `loadWorkspacePackages()` and matches by `parsed.name`, so as long as the workspace contains a package with the parsed name, the rest of the pipeline works without modification.

**Caveats:**

1. **Engine is `private: true`** (per design.md). `publish.ts` line 57 already short-circuits on `pkg.private` and exits cleanly. So if a `@agent-facets/engine@<v>` tag is ever pushed (it shouldn't be — `privatePackages.tag: false` in changesets config would be the way to suppress, but current config has `tag: true`), `publish.ts` will log a skip and exit 0. Verified safe.

2. **CircleCI tag filter** `^@agent-facets\/.+@\d+\..+` will match `@agent-facets/engine@x` and route it to the `release` workflow. The script will then skip publish. Behaviorally fine, but generates noise (a CI run that does nothing). **Recommendation**: confirm the change author wants engine tags to be created at all. If yes, leave alone — the noise is harmless. If no, set `privatePackages.tag` to a more selective value or filter at the `tag.ts` level.

3. **`SCOPED_TAG_PACKAGE_REGEX` in tag.ts** (line 55: `/^@agent-facets\/([a-z0-9-]+)@/`) is used only to extract the bare package name (`protocol`, `engine`) for the CircleCI `package` pipeline parameter. It correctly handles both new names. No change needed.

## 3. Linked-version groupings

### Current `.changeset/config.json`

```json
"linked": [["agent-facets", "@agent-facets/adapter", "@agent-facets/core"]]
```

There is exactly one linked group, containing three packages:
- `agent-facets` (the CLI wrapper)
- `@agent-facets/adapter` (the adapter SDK)
- `@agent-facets/core` (the core library)

### What needs to change for this PR

Per the task brief:

- **Remove `@agent-facets/core`** from the linked group (it is being replaced — or, depending on the design, demoted from the lockstep group).
- **Add `@agent-facets/protocol`** to the linked group, replacing the `core` slot. Result:
  ```json
  "linked": [["agent-facets", "@agent-facets/adapter", "@agent-facets/protocol"]]
  ```
- **`@agent-facets/engine`** is private (per Decision 4 of design.md) and is therefore not relevant to changeset publishing OR to the linked group. With `privatePackages.version: true` in the current config, engine will still receive version bumps in the lockfile, but `publish.ts` will skip publishing on its tag. No changes to the linked array for engine.

**Open question for the author**: should `@agent-facets/core` itself (post-split, still public, contains build/edit/loader logic) remain part of the linked CLI/adapter group? The task brief says "remove core" — confirm that intent. Two valid readings:
- (a) Replace `core` with `protocol` in the lockstep set — protocol becomes the SDK contract that must move with CLI/adapter, and core can version independently.
- (b) Keep `core` in the lockstep set AND add `protocol`. Result: `[["agent-facets", "@agent-facets/adapter", "@agent-facets/core", "@agent-facets/protocol"]]`.

The task brief explicitly says (a), so we follow that.

## 4. CircleCI workflow audit

### Tag-trigger filters

Three workflows have tag filters:

| Workflow      | Tag filter regex                       | Per-package? |
|---------------|----------------------------------------|--------------|
| `release`     | `/^@agent-facets\/.+@\d+\..+/`         | No — matches any scoped package |
| `release-cli` | `/^agent-facets@\d+\..+/`              | No — only the unscoped CLI package |
| `deploy`      | (no tag filter, branches: `main` only) | n/a |

**No filter mentions `core`**. The `release` workflow's regex will match `@agent-facets/protocol@*` and `@agent-facets/engine@*` automatically.

### Contexts and env vars named after `core`

None. Contexts in use: `turbo-cache`, `bot-context`, `slack-secrets`, `github`, `sst`. None reference any package by name.

### Pipeline parameters

`.circleci/release/@config.yml` (and its symlinked development equivalent) declares a single `package` parameter with `default: ""`. The value is supplied at trigger time by `tag.ts` based on `SCOPED_TAG_PACKAGE_REGEX`. No hardcoded package values.

### Required CI changes

**None**, modulo two prose comments:

1. `.circleci/development/@config.yml` line 8 — comment uses `@agent-facets/core` and `@agent-facets/adapter` as examples. Optional: update to `@agent-facets/protocol` to match the new mental model.
2. `.circleci/development/commands/run-check.yml` line 7 — comment about OOM mentions "core + three adapter builds". Optional: update to reflect post-split fan-out.

Neither is required for the pipeline to work.

## 5. Summary — files to touch in this change

### Required

| File | Change |
|------|--------|
| `.changeset/config.json` | Replace `@agent-facets/core` with `@agent-facets/protocol` in the single `linked` group. |
| `scripts/lib/changesets.ts` (line 64) | Replace `'@agent-facets/core': 1` in `PACKAGE_ORDER` with `'@agent-facets/protocol': 1` (or add both, depending on desired display order in the Version Packages PR). |
| `scripts/release/README.md` (line 3) | Update the package list in the doc header to include `@agent-facets/protocol` (and any other public packages added by the split). |

### Optional but recommended (prose hygiene)

| File | Change |
|------|--------|
| `scripts/release/publish.ts` (line 5) | Update docblock example tag from `@agent-facets/core@0.3.0` to `@agent-facets/protocol@0.1.0`. |
| `scripts/lib/io/circleci.ts` (lines 21, 27) | Update docblock examples that reference `@agent-facets/core`. |
| `.circleci/development/@config.yml` (line 8) | Update comment example. (Symlinked into `release/@config.yml` — single edit covers both.) |
| `.circleci/development/commands/run-check.yml` (line 7) | Update OOM-explanation comment to reflect post-split fan-out. |
| `.circleci/AGENTS.md` (line 91) | Update prose example. |
| `scripts/lib/test-helpers.ts` (line 23) | Optional rename of fixture from `@agent-facets/core` to `@agent-facets/protocol`. Pure cosmetic; affects no test outcomes. |

### Pre-publish bootstrap

| Action | Detail |
|--------|--------|
| Run `bun seed:adapters` | After the workspace contains `packages/protocol` (public) but before the first changeset-driven release, this command publishes a `0.0.1` placeholder for `@agent-facets/protocol` so OIDC trusted publishing can be configured on its npm package page. `@agent-facets/engine` is private and is correctly excluded by `isAdapterSeedTarget`. |
| Configure OIDC for `@agent-facets/protocol` | One-time, via npm web UI, following the instructions printed by `seed-adapters.ts`. |

### No-touch (already agnostic)

- `scripts/lib/tags.ts` — `parseTag` is regex-driven and package-name-agnostic.
- `scripts/release/tag.ts` — `SCOPED_TAG_PACKAGE_REGEX` is package-name-agnostic.
- `scripts/release/publish.ts` — purely tag-driven; package lookup via workspace.
- `scripts/release/version.ts` — operates on workspace packages generically.
- `scripts/release/seed-adapters.ts` — `isAdapterSeedTarget` predicate is generic; will pick up `protocol` automatically and skip private `engine`.
- `scripts/lib/ci.ts`, `scripts/lib/npm.ts`, `scripts/lib/announce.ts`, `scripts/lib/constants.ts` — no package-specific logic.
- `.circleci/release/workflows/release.yml`, `release-cli.yml`, `deploy.yml` — tag filters and contexts contain no package names.
- `.circleci/release.yml`, `.circleci/development.yml` — packed outputs of the above; will regenerate via `bun run ci:pack` if any source YAML changes.

### Tasks 15.1 and 15.2 checklist

Based on the typical convention of "15.1 = code/config, 15.2 = docs", the definitive list:

**15.1 (code & config):**
- [ ] `.changeset/config.json` — swap core→protocol in `linked`.
- [ ] `scripts/lib/changesets.ts` — swap core→protocol in `PACKAGE_ORDER`.

**15.2 (docs & comments):**
- [ ] `scripts/release/README.md` — update package list.
- [ ] `scripts/release/publish.ts` docblock example.
- [ ] `scripts/lib/io/circleci.ts` docblock examples.
- [ ] `.circleci/development/@config.yml` comment example.
- [ ] `.circleci/development/commands/run-check.yml` OOM comment.
- [ ] `.circleci/AGENTS.md` example.
- [ ] After any `.circleci/**/*.yml` edits: run `bun run ci:pack` to regenerate `development.yml` and `release.yml`.

## 6. Risks / surprises

1. **`PACKAGE_ORDER` is the only piece of release-pipeline code that hardcodes the package name `@agent-facets/core` in a way that changes runtime behaviour.** Forgetting to update it will not break publishing — it will silently demote core to "unordered" position in the auto-generated Version Packages PR. Low impact, but visible.

2. **`linked` group semantics**: changesets enforces lockstep version bumps within a linked group. Removing core from the group means a CLI patch release will no longer force a core patch release. If the CLI imports core internally, the dependency bump still flows through changesets' `updateInternalDependencies: "patch"` setting (which auto-bumps consumers' version on dependency updates). So in practice CLI releases will still propagate to core users, just not as a coupled major/minor — only as a patch. Confirm this matches the design intent.

3. **`@agent-facets/engine` is private but `privatePackages.tag: true`**: changesets will create a tag for engine when it bumps. The tag will trigger the `release` workflow (matches the regex), which will then fast-skip in `publish.ts`'s private-package guard. This is wasted CI minutes but not a bug. If undesirable, set `privatePackages.tag: false`, but note that this would also affect any future private adapter packages.

4. **Test fixtures use `@agent-facets/core` as the canonical example.** They will continue to pass without modification because the production code is name-agnostic. But a reader new to the codebase will see `@agent-facets/core` everywhere in tests and may incorrectly conclude the pipeline is core-specific. Optional rename for clarity; mechanical and zero-risk.

5. **Symlink between `.circleci/release/@config.yml` and `.circleci/development/@config.yml`**: a single edit covers both packed outputs. Don't edit both files separately.

6. **`bun run ci:check-pack` will fail in CI** if any `.circleci/**/*.yml` file is edited without running `bun run ci:pack`. Mechanical fix; just a reminder to run the pack step.

7. **Seed step is required before first publish**: the protocol package must exist on npm at any version before OIDC trusted publishing can be configured. If the first release attempt happens before seeding, npm publish will fail with auth errors. The README at `scripts/release/README.md` covers this in the "Seeding New Library/Adapter Packages" section — update that section if the protocol-vs-engine distinction needs explicit mention.

8. **No surprises in `parseTag`**: the function is genuinely agnostic. Decision 4 of the design doc is correct.
