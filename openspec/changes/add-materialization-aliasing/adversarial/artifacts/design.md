## Context

Facets are installed by resolving each `facets.json` entry to a verified
archive, deriving a per-asset plan (authored names + canonical inner-archive
file paths + recomputed hashes), and materializing every asset to every
selected adapter. Today the install loop in
`packages/engine/src/install/commit/install-loop.ts` interleaves resolution
and materialization per facet: facet A's assets are written to adapters
before facet B is even resolved. Nothing evaluates the *union* of desired
assets, so two independently published facets that both declare `skill:review`
produce order-dependent, silently-overwriting state — and receipt-driven
removal of one facet can delete a path the other still claims.

Relevant current machinery:

- `facets.json` is `Record<string, string>` (`FacetsJsonSchema`,
  `packages/protocol/src/schemas/project-manifest.ts`) — facet name →
  source-specifier string. There is no slot for per-asset intent.
- `facets.lock` `0.2` (`CurrentLockfileSchema`) records per-facet asset
  entries `{ scope, type, name, files[] }` where `files[].path` is the
  canonical inner-archive path and `files[].integrity` its recomputed hash.
  Version dispatch is exact (design D10 of the `0.2` change): readers accept
  only versions they know.
- The machine-local receipt (`packages/engine/src/install/receipt.ts`,
  version `0.2`) mirrors lockfile ownership so offline removal deletes
  exactly the owned files.
- `buildVerifiedAssetPlan` is the single producer of asset identity +
  ownership for all four resolve paths; `computeAssetList` /
  `diffAssetsForDeletion` key drift deletion on `scope:type:name`.
- Adapters receive one validated asset name per install/delete request and
  are applied uniformly ("same thing per adapter").
- Skills and commands share one namespace (mirrored by the authoring-side
  collision check in `detectNamingCollisions` and the CLI wizard's
  `validate-asset-name.ts`); agents occupy a separate namespace.

The reconciled proposal commits to: transactional whole-set collision
detection on every install path (including frozen), exactly one resolution
per colliding asset (preserve / alias / omit), persisted project intent plus
resolved installation state, unchanged adapter contracts, and unchanged
archive/integrity identities.

## Goals / Non-Goals

**Goals:**

- Detect cross-facet collisions over the complete desired asset set before
  any adapter write, on add, install, update, repair, and frozen paths.
- Represent resolutions (alias, omit) as durable project intent in
  `facets.json` and as resolved state in `facets.lock`, reproducible without
  prompting for teammates, CI, and frozen installs.
- Keep authored identity (archive paths, integrity, publisher-facing names)
  fully separate from effective materialized identity (what adapters see).
- Interactive resolution in `facet add` / `facet install`; structured,
  no-mutation failure everywhere non-interactive.
- Keep the adapter API structurally unchanged.

**Non-Goals:**

- Per-adapter resolutions or adapter-specific asset sets.
- Publisher-declared aliases; any mutation of `facet.json` or archives.
- Collision handling for MCP servers or future asset types.
- Renaming facet identities or `facets.json` keys.
- Changing single-facet (build-time) collision validation.
- Automatic precedence: the system never picks a winner.

## Decisions

### D1. Two-phase install loop: resolve-all, gate, then materialize-all

Restructure `runInstall` so the per-facet loop splits into:

1. **Resolve phase** — resolve every desired facet through its source-kind
   resolver, producing lockfile entries and `VerifiedAssetPlan`s. No adapter
   writes occur here (resolution only touches cache/temp state), so this
   phase stays on the no-mutation path.
2. **Collision gate** — compute the desired *effective* asset set (D3) from
   all plans plus recorded intent (D4); detect residual collisions; collect
   resolutions or fail (D6/D7).
3. **Materialize phase** — the existing per-facet reconcile + `materialize`
   calls, under the journal, now iterating over already-resolved facets.

**Why:** collision freedom is a property of the whole set; any per-facet or
incremental check is order-dependent by construction — the exact defect the
proposal names. Running the gate before the first adapter write is what makes
the guarantee transactional: an unresolved collision MUST leave project,
lockfile, receipt, and adapter state untouched, which is trivial when nothing
has been written yet and requires no journal unwinding.

**Alternatives considered:**

- *Per-facet incremental check against previously-materialized state* —
  rejected: order-dependent, cannot see collisions between two facets both
  being updated in one run.
- *Post-materialization verification with rollback* — rejected: turns a
  planning-time property into a runtime failure needing rollback; violates
  "fail without rewriting any state" for frozen installs.

Plans carry paths and hashes, not bytes (`VerifiedAssetPlan` is deliberately
byte-free), so holding all plans concurrently is cheap. Skill companion
bytes continue to be read per facet during the materialize phase.

### D2. Collision key and namespaces

The collision key SHALL be `(scope, namespace, effectiveName)` where
`namespace` is `skill-command` for skills and commands (shared) and `agent`
for agents. Two assets collide iff their keys are equal and they belong to
different facets. Same-facet duplicates remain a build-time concern
(non-goal).

Scope participates in the key because assets in different scopes do not
share an on-disk tree; today every asset is `project`-scoped so this is
forward-compatibility, not behavior.

### D3. Authored vs. effective identity as a first-class pair

Every planned asset SHALL carry both identities:

- **authored name** — the name in `facet.json`, immutable, used for archive
  paths, integrity records, and all publisher-facing messaging;
- **effective name** — `alias ?? authoredName`, used for adapter
  install/read/delete requests, drift keys, and on-disk layout.

Concretely: `VerifiedAsset` (or a thin wrapper produced at the collision
gate) gains an `effectiveName`; `assetKey` in `materialize.ts` and every
drift diff SHALL key on effective identity, because drift is an on-disk
concept. Integrity verification is untouched: it runs against the verified
directory using canonical archive paths *before* materialization, and the
lockfile `files[]` records keep authored archive paths (D5), so the 3-check
and 1-check chains never see aliases.

An omitted asset has no effective identity: it is excluded from the
materialized set, its companions are not written, and it never enters drift
diffs.

### D4. Project intent: enriched `facets.json` entry, keyed by authored identity

`FacetsJsonSchema` becomes a union per entry:

```jsonc
{
  "facets": {
    "acme/reviewer": "1.x",                       // compact form, unchanged
    "beta/tools": {
      "source": "2.*",
      "assets": {
        "skills":   { "review": "beta-review" },  // alias
        "commands": { "ship": false }             // omit
      }
    }
  }
}
```

- The compact string form SHALL remain valid and semantically identical to
  `{ "source": "<string>" }` with no resolutions — existing manifests parse
  unchanged.
- `assets` mirrors the `facet.json` section names (`skills` / `agents` /
  `commands`), keying by **authored** name. Values are `string` (alias) or
  `false` (omit). "Preserve" is the absence of an entry — see below.
- The manifest writer SHALL emit the compact string form whenever a facet
  has no resolutions, so projects that never hit a collision see zero diff
  churn.

**Preserve is implicit.** Recording explicit "keep" entries was considered
and rejected: a keep can never *make* a set collision-free (two keeps of the
same name still collide), so keeps carry no information the effective-set
computation needs. Detection is always "apply recorded aliases/omissions,
then require the residual effective set to be collision-free" — that
reproduces the user's choices deterministically without prompting, which is
the property the proposal actually requires. Fewer persisted entries also
means fewer stale resolutions to garbage-collect when facets change.

**Stale resolutions.** A resolution referencing an asset the facet no longer
declares SHALL be reported as a warning and ignored during effective-set
computation; interactive flows SHOULD offer to prune it. It is not an error:
publishers remove assets routinely and intent files are hand-mergeable.

**Alias validity.** An alias MUST satisfy the shared asset-name grammar
(`validateAssetName`) and the resulting effective set MUST be collision-free
(including alias-vs-authored and alias-vs-alias collisions in the shared
skill/command namespace). Both are enforced at the collision gate and, for
interactive entry, live in the prompt.

**Alternatives considered:** a flat compound key (`"skill:review": ...`) —
rejected as inventing a new key grammar when `facet.json`'s section shape
already exists; a top-level `resolutions` block parallel to `facets` —
rejected because intent is per-facet and would desynchronize on facet
rename/removal.

### D5. Lockfile: new exact version `0.3` with `as` on asset entries

Introduce `LOCKFILE_VERSION 0.3` under the existing exact-dispatch regime
(read `{1, 0.2, 0.3}`, exact match only):

- Asset entries gain an OPTIONAL `as: string` field — present iff the asset
  is aliased. `name` remains the authored name; `files[]` remains canonical
  authored archive paths with recomputed integrity. Effective identity is
  derivable (`as ?? name`), never stored redundantly.
- Omitted assets SHALL NOT appear in `assets[]`: the lockfile's asset list
  describes resolved *materialized* state, and removal/repair must delete or
  repair exactly the files recorded as owned. Omission intent lives in
  `facets.json` (D4); the frozen consistency gate (D8) cross-checks the two.
- **Version-preserving write:** the writer SHALL emit `0.2` when no facet in
  the project carries any resolution, and `0.3` once any resolution exists.
  This confines the BREAKING format to projects that actually use the
  feature (matching the proposal's compatibility bullet): teams that never
  hit a collision keep full older-CLI interop. Implementation cost is one
  serializer branch over a single in-memory model.

**Why a version bump at all:** an older CLI reading an alias-bearing
lockfile as `0.2` would silently materialize under authored names — exactly
the silent-overwrite correctness failure this change exists to kill. Exact
dispatch makes the old CLI fail loudly instead. The same loud-failure
property holds for the manifest for free: old `FacetsJsonSchema` rejects
object entries as `FACETS_JSON_INVALID`.

**Alternative considered:** optional fields inside `0.2` without a bump —
rejected: it converts a loud incompatibility into a silent misread.

### D6. Engine/CLI seam: resolution via an inversion-of-control callback

`runInstall` gains an optional `resolveCollisions` callback:

```ts
resolveCollisions?: (groups: CollisionGroup[]) =>
  Promise<{ kind: 'resolved'; resolutions: ResolutionSet } | { kind: 'abort' }>
```

where `CollisionGroup` names the colliding effective identity and every
member `{ facet, assetType, authoredName, currentResolution }`. When the
gate finds residual collisions:

- callback present (interactive `add` / `install`): engine invokes it, the
  CLI renders an Ink flow (per group, per asset: keep / alias with live
  grammar-and-uniqueness validation / omit), engine re-validates the
  returned set against the gate, merges it into manifest intent, and
  proceeds — all inside the single held install lock and transaction.
- callback absent (CI, `--frozen-lockfile`, non-TTY): engine returns a new
  structured failure `{ code: 'UNRESOLVED_COLLISIONS', groups }` on the
  no-mutation path. The CLI renders the groups with the concrete
  `facets.json` edit that would resolve them.

**Why:** engine owns transactionality and holds the lock; the CLI owns
display. A callback keeps prompt-then-commit atomic without engine growing
display code (precedent: `onStage`/`onLog` are already inversion points).
The alternative — a separate CLI-orchestrated detect pass followed by a
second `runInstall` — was rejected: it drops the lock between detect and
commit (TOCTOU against concurrent installs and registry `latest` movement)
and duplicates resolution work.

Non-interactive resolution for CI is deliberately *editing `facets.json`* —
no `--resolve foo=bar` flag. Intent belongs in the committed file, not in
ephemeral pipeline arguments.

### D7. Every mutation path runs the gate

The gate (D1 step 2) runs identically for `add`, plain `install`, updates
(a facet update can introduce a brand-new collision), and repair — all of
which already funnel through `runInstall`. `facet remove` also funnels
through it; removals can only shrink the effective set, so the gate passes
trivially but is not special-cased.

### D8. Frozen reproduction: verify, never prompt, never rewrite

Under `--frozen-lockfile` the existing no-mutation preflight
(`detectLockfileDrift`) is extended with an intent-consistency check:

- every recorded alias in `facets.json` MUST match the corresponding entry's
  `as` in the lockfile;
- every recorded omission MUST correspond to no asset entry;
- the effective set derived from the lockfile MUST be collision-free.

Any violation fails as `UNRESOLVED_COLLISIONS` (or `LOCKFILE_DRIFT` where it
is literally version drift) with zero writes — before receipt-driven
cleanup, preserving the established "frozen consistency before cleanup"
ordering. Frozen materialization then reproduces effective names from
`as ?? name` without prompting.

### D9. Materialization, receipt, and removal use effective identity

- `materialize` passes the effective name in every adapter
  install/read/delete request; skill companion placement follows the
  effective name's directory. The adapter API shape is unchanged — adapters
  keep receiving one validated name and cannot tell an alias from an
  authored name.
- The receipt bumps to `0.3` (exact dispatch, mirroring D5): asset records
  become `{ scope, type, name, as?, files }` with `name` authored and
  deletion driven by `as ?? name`. Receipts are machine-local; `0.2`
  receipts load with primary semantics unchanged (no `as` ⇒ effective =
  authored), so no migration machinery beyond the schema union is needed.
- Alias *changes* (user edits `beta-review` → `code-review`) fall out of
  D3's effective-identity drift keys: `diffAssetsForDeletion` sees the old
  effective identity leave the set and the new one enter, deleting and
  writing exactly the right files.
- Omission on an already-materialized asset likewise falls out: the asset
  leaves the effective set, drift deletion removes its primary and owned
  companions via the receipt's recorded files.

### D10. Pure-protocol vs. engine split

The collision-detection and effective-set computation are part of the spec
("would survive a Rust rewrite"), so they land in `@agent-facets/protocol`
as pure functions over asset identities + intent — alongside the extended
`FacetsJsonSchema`, `0.3` lockfile schema, and an exported
`effectiveAssetName` helper. Orchestration (two-phase loop, callback,
journal, receipt) is engine. CLI gains the Ink resolution view and the
structured-failure rendering.

## Risks / Trade-offs

- [Two-phase loop changes failure ordering: a facet late in the map now
  fails *before* earlier facets materialize] → This is strictly safer
  (fewer partial states) but changes observed progress events; `onStage`
  gains explicit `resolve-phase` / `materialize-phase` events so the CLI
  timeline stays honest.
- [Version-preserving lockfile write (D5) means one project can oscillate
  between `0.2` and `0.3` as resolutions come and go] → Acceptable: both
  directions are lossless for a resolution-free state, and the serializer
  branch is trivially testable. The alternative (always `0.3`) breaks older
  CLIs for every project on first contact.
- [Implicit "preserve" (D4) means a *new* collision introduced by an update
  re-prompts even though the user previously kept one side] → Intended:
  a new colliding member is genuinely new information; silently reusing an
  old choice would pick a winner the user never approved.
- [Stale resolutions accumulating in `facets.json`] → Warn-and-ignore plus
  interactive pruning (D4); never a hard failure, so upstream asset renames
  don't brick installs.
- [Callback re-entrance: a buggy CLI callback returns an invalid resolution
  set] → Engine re-runs the gate on the returned set and fails structurally
  rather than trusting the callback; the callback is advisory input, not a
  bypass.
- [Aliased skill directories change companion paths on disk while lockfile
  `files[]` keeps authored paths] → The receipt records what deletion needs
  (effective identity + owned files); repair reads adapter state by
  effective name and compares bytes against authored archive paths. The
  pairing is exercised directly by repair/removal tests.

## Migration Plan

1. **Protocol**: extended `FacetsJsonSchema` union, `0.3` lockfile schema +
   exact dispatch, pure collision/effective-set functions. Purely additive;
   ships dark.
2. **Engine**: two-phase `runInstall`, collision gate, `UNRESOLVED_COLLISIONS`
   failure, receipt `0.3`, frozen consistency extension, version-preserving
   writers. Projects without resolutions produce byte-identical outputs.
3. **CLI**: interactive resolution flow in `add`/`install`, structured
   failure rendering.
4. **Docs** (see below), then changelog.

Rollback within the compatibility story: a project that removes all
resolutions from `facets.json` and reinstalls returns to a `0.2` lockfile
readable by older CLIs. No forced migration exists for uninvolved projects.

## Documentation Impact

Per the proposal's doc survey, the following MUST be updated:
`docs/specification/manifest.mdx` (namespace rules now consumer-facing),
`docs/specification/project-manifest.mdx` (enriched entry form),
`docs/specification/lockfile.mdx` (`0.3`, `as`, omission semantics),
`docs/specification/install.mdx` and `docs/specification/commit.mdx`
(collision gate placement, transactional guarantee, frozen behavior),
`docs/specification/terminology.mdx` (authored vs. effective identity),
`docs/cli/add.mdx` and `docs/cli/install.mdx` (interactive flow,
`UNRESOLVED_COLLISIONS` failure), `docs/guides/install-facets.mdx` and
`docs/guides/troubleshooting.mdx` (resolving collisions, CI guidance), and
the root `README.md` if it demonstrates `facets.json` entries. No existing
doc contradicts this design; the gap is purely additive coverage.

## Open Questions

- Should the interactive flow offer a "remember nothing, omit all newcomers"
  bulk action for large collision groups, or is per-asset choice the only
  mode in v1? (Leaning per-asset only; bulk actions can ship later without
  format changes.)
- Does `facet edit` (scanner/reconcile) need to learn the enriched manifest
  entry in this change, or is read-tolerance sufficient until a follow-up?
  Read-tolerance is the minimum bar: it MUST NOT corrupt object entries when
  rewriting `facets.json`.
- Exact wording of the failure-rendered `facets.json` edit suggestion —
  should the CLI print a ready-to-paste JSON fragment per group?
