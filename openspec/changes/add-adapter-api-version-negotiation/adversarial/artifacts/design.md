## Context

The adapter boundary is currently unversioned end to end:

- `defineAdapter()` (`packages/adapter/src/define-adapter.ts`) returns a frozen `Adapter` with no contract identifier; the `Adapter` interface (`packages/adapter/src/types.ts`) carries only `name`, `supportsInstall`, and the positional methods.
- npm adapter installs resolve `GET https://registry.npmjs.org/<name>/latest` unconditionally (`packages/engine/src/sources/adapter/npm.ts`), so the newest published release is always chosen regardless of contract shape.
- `verifyAdapter()` (`packages/engine/src/adapters/verify.ts`) checks only that a default export with `name` and `buildAssetMetadata` exists, and it still throws instead of returning a result.
- `placeAdapter()` (`packages/engine/src/adapters/placement.ts`) copies `adapter.js` directly over the installed bundle — a non-atomic, no-provenance overwrite. The only on-disk record of an installed adapter is the bundle itself.
- `loadInstalledAdapters()` (`packages/engine/src/adapters/loader.ts`) dynamically imports whatever bundles exist and hands them to `ensureAdapters()`, `facet build`, and the install pipeline as the current TypeScript `Adapter` type, unchecked.
- `parseAdapterSpecifier()` (`packages/engine/src/sources/adapter/specifier.ts`) has no version syntax for npm specifiers — `opencode`, `@scope/pkg`, `git+…`, and paths only.

The reconciled proposal designates the current positional contract as adapter API `0.0`, makes the CLI support exactly `0.0`, replaces `/latest` resolution with compatibility-aware selection from package metadata, gates placement and loading on a runtime declaration, and treats undeclared bundles as incompatible. The project is forward-only: published CLIs cannot be retrofitted, so the design optimizes for a clean boundary from this release onward, not for protecting old CLIs.

Constraint inventory relevant to the design:

- Engine is Bun-native (may use `Bun.semver`, `Bun.file`); the adapter SDK is published, Node-friendly, and must stay a leaf (no engine/CLI deps).
- Errors are values: every new failure mode MUST be a discriminated-union member, not a throw. Existing throwing seams (`verifyAdapter`, `placeAdapter`, bundler) that this change touches SHOULD be converted at the same time, since their failure modes become part of the user-facing contract.
- The protocol package is for spec-defined facet primitives; the adapter API version is a CLI/SDK concern and MUST NOT leak into `@agent-facets/protocol`.

## Goals / Non-Goals

**Goals:**

- Define a single canonical source of truth for the adapter API identifier and stamp it onto every runtime adapter without author involvement.
- Make npm resolution select the highest package version whose declared adapter API the CLI supports, honoring explicit ranges and failing loudly on explicit incompatible exact versions.
- Gate bundle placement and installed-bundle loading on an exact-equality API check, with structured failures before any adapter method is invoked.
- Make installed-bundle replacement atomic: stage, verify, swap; any failure leaves the previous bundle untouched.
- Persist installation provenance (specifier, resolved package/version, API version, integrity) alongside the installed bundle.
- Surface compatibility in `facet adapter list` and fail facet installation before materialization writes when a selected adapter is incompatible.
- Keep `docs/` aligned (see "Documentation impact").

**Non-Goals:**

- No change to the positional method signatures that become API `0.0`, and no second API version.
- No multi-version side-by-side adapter storage.
- No automatic upgrade of an incompatible installed adapter during `facet install`.
- No npm dist-tag manipulation, and no attempt to make pre-existing CLI releases compatibility-aware.
- No coupling of the adapter API to facet archive versions, facet package versions, or the SDK package's own semver.

## Decisions

### D1: The API identifier is an opaque string constant owned by the SDK

`@agent-facets/adapter` exports:

```ts
/** The adapter API contract this SDK implements. Compared by exact string equality — never a semver range. */
export const ADAPTER_API_VERSION = '0.0'
```

`defineAdapter()` stamps it: the returned `Adapter` gains `readonly apiVersion: string`, set unconditionally from the constant. Authors cannot (and need not) supply it — the *input* type becomes `AdapterDefinition = Omit<Adapter, 'apiVersion'>`, so an author-supplied `apiVersion` is a type error rather than a silently honored lie. This is the illegal-states rule applied to the SDK surface: an adapter whose stamped version disagrees with the SDK that built it is unrepresentable at the type level.

**Why a plain string, not `{ major, minor }`:** the proposal mandates exact-equality semantics with no range interpretation. A structured type invites callers to compare components ("same major ⇒ compatible"), which is precisely the semantics the proposal forbids. An opaque string makes the only possible comparison the correct one.

**Alternatives considered:**
- *Author-declared `apiVersion` in the definition:* rejected — authors would drift from the SDK actually bundled; the SDK is the only party that knows which contract it implements.
- *Deriving the API from the SDK package semver:* rejected by the proposal (independence requirement) — SDK releases fix bugs without changing the call contract.

### D2: Engine owns the supported set; the identifier string is imported, not restated

Engine (which already depends on `@agent-facets/adapter` for the `Adapter` type) defines:

```ts
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
export const SUPPORTED_ADAPTER_API_VERSIONS: readonly string[] = [ADAPTER_API_VERSION]
```

Membership is exact string equality. The *set* lives in engine because "which APIs this CLI can invoke" is a property of the invoker, not the SDK: a future CLI could support `['0.0', '1.0']` while the SDK's canonical version is `1.0`. The *identifier* is imported so `'0.0'` is written exactly once in the monorepo.

**Alternative — CLI-owned set:** rejected; the compatibility gates live in engine (verify, loader, resolution), and engine must not read CLI state. The CLI only renders engine's structured output.

### D3: npm metadata declaration via a top-level `facetAdapter` field, full-packument resolution

First-party adapter packages (and third-party ones that want pre-download selection) declare in `package.json`:

```json
"facetAdapter": { "apiVersion": "0.0" }
```

For the monorepo's own adapters, `defineAdapter`'s stamping covers the runtime side automatically; the `package.json` field is added to each `packages/adapters/*` package and validated by a repo test that compares it against `ADAPTER_API_VERSION` (single-source enforcement at CI time, since JSON cannot import the constant — this is the documented exception to the duplication rule, with the test as the guard).

Resolution fetches the **full packument** (`GET https://registry.npmjs.org/<name>`) instead of `/<name>/latest`. The abbreviated "corgi" packument (`application/vnd.npm.install-v1+json`) strips custom top-level fields, so it cannot carry `facetAdapter`; the full packument preserves each version's `package.json` fields, letting the CLI read `versions[v].facetAdapter.apiVersion` before downloading anything.

**Selection algorithm** (new `resolveCompatibleNpmVersion` in `packages/engine/src/sources/adapter/npm.ts`):

1. Fetch full packument; failure modes extend the existing `DownloadNpmResult`-style discriminated unions.
2. Candidate set = all versions, excluding prereleases unless the user's explicit spec includes/names one.
3. If the specifier carries a range → intersect candidates with the range (via `Bun.semver.satisfies`).
4. If the specifier carries an exact version → the candidate set is exactly that version; if its declared API is missing/malformed/unsupported, fail with `adapter-api-incompatible` (never substitute another release).
5. Order remaining candidates descending with `Bun.semver.order`; pick the first whose `facetAdapter.apiVersion` is a string in `SUPPORTED_ADAPTER_API_VERSIONS`. Versions with a missing or malformed declaration are simply not candidates (they are incompatible by definition, per the proposal).
6. If nothing qualifies → structured failure carrying: the newest considered release, its declared (or missing) adapter API, and the CLI's supported set — exactly the fields the proposal requires for diagnostics.

The tarball for the selected version is then downloaded from that version's `dist` entry, with the existing SRI/shasum + tar-slip hardening unchanged.

**Alternatives considered:**
- *Custom npm dist-tags per API (e.g. `facet-api-0.0`):* rejected — the proposal forbids depending on tag movement, and tags are mutable registry state that can drift from version metadata.
- *Downloading `latest` and checking after extraction:* rejected — the proposal requires pre-download determination and highest-*compatible* selection, which requires per-version metadata.
- *Keywords or `engines` abuse:* rejected — not structured, collides with existing tooling semantics.

### D4: Adapter specifier grammar gains an npm version suffix

`parseAdapterSpecifier` learns `name@<spec>` / `@scope/name@<spec>` / `opencode@<spec>` (alias + suffix). Parsing splits on the last `@` past position 0 (scope-safe). The parsed npm variant becomes:

```ts
{ type: 'npm'; packageName: string; versionSpec: NpmVersionSpec }
type NpmVersionSpec =
  | { kind: 'none' }              // plain install → highest compatible
  | { kind: 'exact'; version: string }
  | { kind: 'range'; range: string }
```

`exact` vs `range` is distinguished because the proposal assigns them different failure semantics (exact must fail rather than substitute). A suffix that is a valid exact semver → `exact`; anything else that `Bun.semver` accepts as a range → `range`; otherwise a new `invalid-version-spec` failure arm on `ParseAdapterSpecifierResult`.

Git and local specifiers take no version suffix — they cannot be version-selected (proposal Impact) and rely wholly on runtime verification (D6).

### D5: Runtime declaration is final; metadata is only a selection aid

After bundling/loading a candidate, verification checks the runtime export's `apiVersion`:

- missing or non-string → incompatible (`declared: null`),
- not in `SUPPORTED_ADAPTER_API_VERSIONS` → incompatible,
- for npm installs where package metadata declared a version: metadata ≠ runtime declaration → `api-declaration-conflict` failure (fail rather than pick either side).

`verifyAdapter` is converted from throwing to a result type as part of this change:

```ts
type VerifyAdapterResult =
  | { ok: true; adapter: Adapter; apiVersion: string }
  | { ok: false; failure:
      | { kind: 'load-failed'; cause: string }
      | { kind: 'no-default-export' }
      | { kind: 'invalid-shape'; field: string }
      | { kind: 'api-missing' }
      | { kind: 'api-unsupported'; declared: string; supported: readonly string[] }
      | { kind: 'api-declaration-conflict'; packageDeclared: string; runtimeDeclared: string } }
```

These arms flow into `AdapterInstallFailure` (replacing the current stringly `verify-failed` arm's `cause` with the structured union) so the CLI can render the adapter name, declared/missing API, supported APIs, and the compatible-install command without parsing messages. This ordering also satisfies the proposal's "before any adapter method is invoked" requirement: verification only reads data properties of the default export.

**Why convert now rather than keep wrapping throws:** the incompatibility arms are user-facing contract (the CLI must render specific fields from them); threading them through `Error.message` strings would violate the errors-are-values rule at the exact seam this change exists to formalize.

### D6: Git and local sources pass through the same runtime gate

Git/local adapters skip D3 entirely (no packument) and MUST pass D5's runtime verification as supplied. There is no metadata/runtime conflict check for them (no metadata side exists — the conflict arm is unrepresentable for these sources, which the failure type reflects by carrying the npm-declared value only in the npm path).

### D7: Provenance receipt `adapter.json` beside the bundle

Placement writes a receipt at `$FACET_DIR/adapters/<name>/adapter.json`:

```json
{
  "schemaVersion": 1,
  "specifier": "opencode",
  "source": { "type": "npm", "package": "@agent-facets/adapter-opencode", "version": "0.9.0" },
  "apiVersion": "0.0",
  "integrity": "sha512-…",
  "installedAt": "2026-07-21T00:00:00Z"
}
```

- `source` is a tagged union mirroring `ResolvedAdapterSpecifier` (`npm` with resolved exact version, `git` with url+commit, `local` with path).
- `integrity` is the npm tarball SRI when the source is npm; for git/local (and for rebundled npm fast-path fallbacks) it is a sha512 of the placed `adapter.js` bytes, tagged so the two kinds are not conflated.
- A missing or unparsable receipt next to an existing bundle is treated as "provenance unknown" — the bundle is still governed by runtime verification (D5); the receipt only enriches diagnostics and powers replacement/`list` output. This keeps pre-change installs representable without a migration step.

**Alternative — central registry file (`$FACET_DIR/adapters.json`):** rejected; per-adapter receipts live and die with `rm -rf` of the adapter directory (the existing `removeAdapter` semantics) and cannot desynchronize from the set of installed bundle directories.

### D8: Atomic replacement via stage-and-swap

`placeAdapter` becomes stage-based and result-typed:

1. Verify the candidate bundle (D5) **before** touching the installed location — verification already happens in `locateAndVerifyAdapter`; placement re-receives the verified `apiVersion` and receipt data rather than re-verifying.
2. Write `adapter.js` + `adapter.json` into a staging dir on the same filesystem: `$FACET_DIR/adapters/.staging-<name>-<random>/`.
3. Swap: rename the existing `adapters/<name>/` (if any) to `.old-<name>-<random>`, rename staging to `adapters/<name>/`, then delete the old dir. If the second rename fails, rename the old dir back — the previous install is restored.
4. Any failure in steps 1–2 deletes only the staging dir; the installed adapter is never touched. Failure arms (`stage-write-failed`, `swap-failed`) join `AdapterInstallFailure`.

**Why dir-rename rather than file-overwrite:** the unit of installation is the directory (bundle + receipt); two sequential file writes can be torn by a crash between them. Directory rename on one filesystem is the cheapest all-or-nothing primitive available without a lockfile. The `.staging-`/`.old-` prefixes are filtered out of `listInstalledAdapters` (which already requires an `adapter.js` to count a directory, but the filter is made explicit so a crashed swap never surfaces a half-install).

### D9: Loader classifies instead of filtering silently

`loadInstalledAdapters` currently returns `Adapter[]` and swallows failures into optional warnings. It is replaced (engine-internal rename, CLI updated) by a classifying loader:

```ts
type InstalledAdapterStatus =
  | { name: string; status: 'compatible'; adapter: Adapter; apiVersion: string; receipt: AdapterReceipt | null }
  | { name: string; status: 'incompatible'; declaredApi: string | null; supported: readonly string[]; receipt: AdapterReceipt | null }
  | { name: string; status: 'load-failed'; cause: string }
```

Consumers then choose policy explicitly:

- `ensureAdapters` (add/remove/install) and `facet build`/publish flows: any *selected* adapter that is not `compatible` produces a structured pre-materialization failure naming the adapter, its declared/missing API, the supported set, and the fix command (`facet adapter install <specifier>`), and the command exits before any materialization or build writes. Facet installation MUST NOT partially materialize and then discover incompatibility — the gate runs when adapters are gathered, which is before `runInstall` receives them.
- `facet adapter list`: renders every entry — compatible adapters as today plus their API and resolved version (from the receipt), incompatible ones marked unsupported with declared-vs-supported detail, load-failures with their cause. This satisfies the proposal's list requirement without a second disk scan.

**Why classify at the loader rather than gate inside `runInstall`:** `runInstall` receives adapters as a parameter and is also driven by tests with fakes; the trust boundary is where bundles come off disk. Gating at load keeps `runInstall`'s contract unchanged (it only ever sees compatible adapters) while `list` still gets the full classification. The incompatible arm remains representable so `list` and diagnostics can describe it — it just never crosses into materializing code paths.

### D10: First-party picker and aliases ride the same npm path

`FIRST_PARTY_ADAPTERS` entries and `BUILTIN_ALIASES` resolve to npm packages and therefore inherit D3's compatible-highest selection with no special casing. The picker's failure rendering reuses the same structured no-compatible-release data.

## Risks / Trade-offs

- **[Full packument size]** Full packuments are larger than `/latest` responses (all versions inline). → Adapter packages are young and small; fetch happens once per install, not per facet operation. If this ever matters, a `?write=false` cached fetch or per-version `GET /<name>/<version>` fallback can be added without changing the contract.
- **[Custom field stripped or wrong in metadata]** Some publish pipelines rewrite `package.json`; a registry entry could omit or misstate `facetAdapter`. → Omission just removes that version from candidacy (correct per the proposal's "undeclared = incompatible"); misstatement is caught by D5's metadata/runtime conflict check before placement. The runtime declaration is always final.
- **[Repo-side duplication of `0.0` in adapter package.json files]** JSON can't import `ADAPTER_API_VERSION`. → CI test asserts every `packages/adapters/*/package.json` `facetAdapter.apiVersion` equals the SDK constant (documented exception to single-source rule, with the guard).
- **[`Bun.semver` semantics]** Range/prerelease behavior must match npm's expectations closely enough for adapter authors. → Selection only needs ordering + satisfaction, both provided; prerelease exclusion is explicit in D3 step 2 rather than delegated to range semantics. Unit tests pin the edge cases (prerelease-only packages, build metadata).
- **[Swap non-atomicity across the two renames]** A crash between rename-old and rename-new leaves no installed adapter (though both dirs still exist under prefixed names). → Window is microseconds and recovery is a re-install; the previous state is recoverable manually from `.old-*`. A journal was considered and rejected as disproportionate for a single-user local directory.
- **[Breaking existing installs]** Every currently installed bundle predates stamping and becomes incompatible on CLI upgrade. → Intended (proposal BREAKING). The loader's `incompatible` arm plus `ensureAdapters` messaging turns this into a one-command fix; release ordering (below) guarantees a compatible release exists to install before any CLI that requires it ships.
- **[Third-party adapters without metadata]** They never match pre-download selection once published CLIs require it, even if their runtime would verify. → Accepted: the proposal makes metadata declaration a requirement for npm-distributed adapters; git/local installs remain the escape hatch during author migration.
- **[Loader API change ripples]** `loadInstalledAdapters` has ~6 call sites across engine tests and CLI. → Mechanical; the classifying return type makes every caller's policy explicit, which is the point.

## Migration Plan

Order matters because the CLI must never ship requiring declarations that no published adapter release carries:

1. **SDK release** — `ADAPTER_API_VERSION`, `apiVersion` stamping, `AdapterDefinition` input type. Backward-compatible for authors (no definition changes required).
2. **First-party adapter releases** — rebuild `packages/adapters/*` against the new SDK, add `facetAdapter.apiVersion` to each `package.json`, publish. These releases are compatible with both old CLIs (which ignore the new field and extra export property) and the new CLI.
3. **CLI/engine release** — compatible resolution, verification gate, atomic placement, receipts, classifying loader, list/diagnostics output, docs.
4. **Rollback** — each step is independently revertible: the SDK stamp and metadata field are inert for old CLIs; reverting the CLI release restores `/latest` behavior. No data migration exists to roll back; receipts are additive and ignored by older CLIs.

Existing users upgrading the CLI see incompatible-adapter diagnostics on first use and run the suggested `facet adapter install <name>` per adapter; no automatic rewrite of `$FACET_DIR` occurs.

## Documentation impact

Per the proposal and a check of current `docs/` content:

- `docs/cli/adapters/install.mdx` — document the `@version`/`@range` specifier suffix, compatible-highest selection for plain installs, exact-version incompatibility failure, and the no-compatible-release diagnostic. Currently documents specifier forms only, with no version syntax.
- `docs/cli/adapters/list.mdx` — new columns/annotations: adapter API version, resolved package version, supported/unsupported marker. (Not named in the proposal's doc list, but its output changes; leaving it stale would violate Article III.)
- `docs/guides/custom-adapters.mdx` — SDK section gains the API-version model: `defineAdapter` stamps `apiVersion`; npm-published adapters must declare `facetAdapter.apiVersion`; git/local development flows rely on runtime verification.
- `docs/guides/troubleshooting.mdx` — new entries for `api-missing`/`api-unsupported`/`api-declaration-conflict` failures and the incompatible-installed-adapter pre-materialization failure, each with the fix command.
- `docs/specification/install.mdx` — describe the compatibility gate ordering: selection → download → verify → place → (facet install) pre-materialization check.
- Root `README.md` — no changes required; it does not describe adapter resolution behavior.

## Open Questions

- **Prerelease policy edge:** when a user requests a range that only prerelease versions satisfy, should selection consider them (npm's `semver` requires explicit prerelease tags in the range)? Current design says yes only when the range names a prerelease; confirm against `Bun.semver.satisfies` behavior before locking tests.
- **Receipt for pre-existing installs:** should the new CLI backfill a minimal receipt (`source: unknown`) when it verifies a legacy bundle it is about to replace, or leave receipt creation purely to new installs? Design assumes the latter (receipts only from new placements).
- **`adapter remove` of a half-swapped state:** should `removeAdapter` also sweep `.staging-*`/`.old-*` orphans for its adapter name? Proposed: yes, as a cheap self-heal, but it is not required by any proposal requirement.
