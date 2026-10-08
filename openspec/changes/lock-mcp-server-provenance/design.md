## Context

The reconciled [proposal](proposal.md) chooses a fingerprint-only MCP inventory in lockfile `0.4`, not full declarations, richer adapter requests, or a new CLI command. The consumer is an exporter/sealing workflow that already holds portable declarations and needs a complete expected server set plus every contributing facet's provenance.

The current installation pipeline already has the required information, but exposes its parts separately:

- `packages/engine/src/install/commit/types.ts:26` carries verified declarations, source, version, and facet integrity together.
- `packages/protocol/src/materialization/servers.ts:178` plans aliases, omissions, fingerprints, and all claimants; `planned` includes omitted declarations while `configurations` does not.
- `packages/engine/src/install/commit/compose.ts:175` constructs locked facet entries, currently recording only assets.
- `packages/engine/src/install/commit/resolve-all.ts:105` reconciles verified content before composition, adapter planning, cleanup, or transaction creation.
- `packages/engine/src/install/frozen-gates.ts:48` checks locked asset intent before resolution, but server intent currently needs declarations.
- `packages/engine/src/install/remove/refine.ts:250` can remove facets without resolving remaining content, using locked state plus receipt witnesses.

The implementation SHALL preserve the repository's boundaries: protocol owns schemas and pure planning; engine owns resolution, verification orchestration, and transactional writes; CLI renders structured failures. The Adapter SDK stays a leaf and its API remains `0.3`. Protocol remains usable on Node 22+ without Bun, filesystem access, or network I/O.

```text
verified facet definitions + project intent
                  |
           declaration planning
                  |
          +-------+-----------------------+
          |                               |
  complete authored records       selected declarations
          |                               |
  facets.lock 0.4                  existing adapter plans
          |
  public inventory derivation
          |
  effective names + fingerprints + all origins
          |
  consumer compares its independently fingerprinted exports
```

## Goals / Non-Goals

**Goals:**

- Record every authored server, including omissions and server-only facets, without generated declaration payloads.
- Preserve many-to-many provenance after naming and composition, with no selected origin or inferred winner.
- Make selected inventory derivable through a small public, pure protocol API.
- Reconcile recorded metadata with verified definitions on reproduction, and reject frozen intent drift before fetching.
- Migrate old formats through verified resolution without breaking receipt-based authority or fabricating completeness.

**Non-Goals:**

- Full-definition export, a dedicated export-comparison API, a new CLI command, or an Adapter SDK API change.
- New approval, ownership, deletion, authentication, or MCP execution behavior.
- New fingerprint semantics, archive formats, project-manifest formats, or a claim that a fingerprint proves publisher authenticity or archive membership.
- Making cold-cache installation offline. Only inventory derivation and consumer-side comparison are content-acquisition-free.

## Decisions

### D1. Add an exact `0.4` schema with required per-facet server records

`schemas/lockfile.ts` SHALL add `LOCKFILE_VERSION_0_4`, `Lockfile04Schema`, corresponding inferred types, and `CurrentLockfileServerEntry`. Current writer aliases SHALL select `0.4`; exact readers SHALL retain `0.2` and `0.3`. Existing asset records in `0.4` SHALL keep the `0.3` shape.

The new field on each facet entry is:

```ts
servers: Array<{
  name: string
  fingerprint: McpServerFingerprint
  materialization: MaterializationDisposition
}>
```

The array SHALL be required, including when empty. Authored names SHALL pass `validateMcpServerName`; fingerprints SHALL pass `isMcpServerFingerprint`; dispositions SHALL use the existing tagged schema. Records SHALL be strictly ascending by authored name under `compareCodeUnits`, which also rejects duplicates. An alias never changes `name` or `fingerprint`. There is no persisted effective-name field beyond the existing aliased disposition, and no facet identity duplicated inside a server record.

`loaders/lockfile.ts` SHALL extend `ParsedLockfile` and exact parser dispatch. Malformed `0.4` documents SHALL fail as `0.4`, without reinterpretation. Code needing server inventory SHALL discriminate on the document version, not probe for a `servers` property: legacy documents can already contain arbitrary extension fields with that name. A legacy empty project still has an unavailable server-inventory format rather than a synthesized `0.4` inventory.

**Alternatives:** Optional records conflate unknown with empty. A top-level deduplicated server list loses authored origins and omissions. Adding servers to `AssetType` misrepresents configuration as a text asset. All are rejected.

### D2. Bind `0.4` to the existing semantic fingerprint, not a native-file hash

The binding is `facets:mcp-server:v1`, as implemented in `mcp/fingerprint.ts:70`. The encoding covers transport and every portable declaration value, preserves argument order and literal values, sorts environment keys, normalizes absent optional collections to empty, and excludes names.

The lockfile schema/spec SHALL define this binding. No per-record algorithm selector or new fingerprint function is needed. A future encoding change SHALL introduce a new lockfile version and retain the old encoding for old readers rather than changing the meaning of `0.4` hashes.

`schemas/lockfile.ts` SHALL export the independent literal `LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING = 'facets:mcp-server:v1'`; it SHALL NOT alias the current encoder's tag. `mcp/fingerprint.ts` SHALL export its existing tag as `MCP_SERVER_FINGERPRINT_ENCODING`, and protocol's public index SHALL export both constants. Tests SHALL pin the literal binding, its agreement with the current encoder, and fixed canonical-preimage and digest vectors for both transports. A future encoder revision SHALL introduce version-specific dispatch and retain the `0.4` vectors, rather than updating the old binding constant.

Facet integrity still binds the complete archive; server fingerprints bind canonical declaration semantics. They SHALL NOT substitute for each other. Generating a record requires verified facet content, and checking a downstream export requires hashing the actual exported portable values, not copying the expected fingerprint. Tool-native JSON/TOML bytes are not a valid fingerprint preimage.

**Alternatives:** Raw JSON hashing spuriously changes with property order and optional empty collections. Per-field hashes increase the contract surface without improving this use case. A new semantic encoding would break existing equivalence and approval behavior for no benefit.

### D3. Separate locked inventory derivation from fingerprint-only intent planning

Add `deriveLockedMcpInventory(lockfile: SupportedLockfile)` to protocol's main entrypoint. Callers SHALL parse untrusted bytes with `parseLockfileDocument` first. The helper SHALL discriminate on `lockfile.lockfileVersion`; `SupportedLockfile` already contains this literal discriminator. It SHALL NOT infer capability from the presence of a `servers` field.

Derivation has no I/O, source resolution, receipt access, or manifest-override parameter. It describes recorded inventory, not hypothetical intent. Its public output SHALL retain the existing selected-server shape and add a complete authored view:

```ts
interface LockedMcpOrigin {
  readonly facet: string
  readonly source: Readonly<LockfileSource>
  readonly version: string
  readonly facetIntegrity: string
  readonly authoredName: string
  readonly materialization: Readonly<MaterializedDisposition>
}

type LockedMcpAuthoredServer =
  Omit<LockedMcpOrigin, 'materialization'> & {
    readonly fingerprint: McpServerFingerprint
    readonly materialization: Readonly<MaterializationDisposition>
  }

interface LockedMcpServer {
  readonly effectiveName: string
  readonly fingerprint: McpServerFingerprint
  readonly origins: readonly [LockedMcpOrigin, ...LockedMcpOrigin[]]
}

type DeriveLockedMcpInventoryResult =
  | {
      readonly ok: true
      readonly authored: readonly LockedMcpAuthoredServer[]
      readonly servers: readonly LockedMcpServer[]
    }
  | {
      readonly ok: false
      readonly reason: 'inventory-unavailable'
      readonly lockfileVersion: 0.2 | 0.3
      readonly requiredVersion: 0.4
    }
  | {
      readonly ok: false
      readonly reason: 'collision'
      readonly authored: readonly LockedMcpAuthoredServer[]
      readonly groups: readonly LockedMcpCollisionGroup[]
    }
```

`authored` SHALL contain every record, including omissions, with provenance joined from its enclosing facet. It SHALL remain available on collision without returning a partial selected set. Collision groups SHALL identify every conflicting origin and fingerprint without declaration values. Malformed records remain parser failures.

Selected origins SHALL exclude omissions and preserve distinct `(facet, authoredName)` claims, including multiple authored names from one facet. Equal fingerprints at distinct effective identities SHALL remain separate. Authored records SHALL sort by facet then authored name; selected servers SHALL use existing portable identity ordering, with origins ordered by facet then authored name. Output arrays, dispositions, and recognized source fields SHALL be copied into readonly values without mutable input aliases or opaque extension objects.

Export a separate pure planning entry point:

```ts
interface LockedServerContribution {
  readonly facet: string
  readonly servers: readonly {
    readonly name: string
    readonly fingerprint: McpServerFingerprint
  }[]
  readonly overrides?: FacetMaterializationOverrides
}

planLockedServerInventory(
  contributions: readonly LockedServerContribution[],
): PlanLockedServerInventoryResult
```

This planner accepts complete fingerprint-only authored contributions plus project intent. Absence of an override SHALL mean authored materialization. Its success result SHALL carry `planned` records including omissions, effective `configurations` with every claimant, and `staleOverrides`. Failure arms SHALL distinguish `invalid-alias` problems from complete `collision` groups; collision results SHALL retain stale-override diagnostics. Planned records carry facet, authored name, fingerprint, and disposition. Configurations carry identity, key, fingerprint, and claimants. Collision members additionally carry effective name. None carries a declaration or asserts verification.

`planServerMaterialization` and `planLockedServerInventory` SHALL be thin wrappers over one private server-claim core around `planEffectiveNames`, sharing the server namespace, portable collision key, fingerprint-equivalence predicate, stale sweep, and ordering. Existing declaration-based signatures and clone/freeze behavior SHALL remain unchanged.

`deriveLockedMcpInventory` SHALL call the fingerprint-only planner with recorded dispositions translated into overrides, then join provenance. The engine SHALL call the planner directly for frozen checks and removal with manifest overrides, never manufacture a lockfile-shaped projection. An invalid-alias result inside derivation of a schema-valid document is an invariant violation, not a collision or empty success.

**Alternatives:** An override parameter on derivation confuses recorded and hypothetical state. Synthetic lockfile projections duplicate the planner's stale-intent machinery. Optional or fabricated declarations weaken existing adapter-facing types. A dedicated export-comparison API remains unnecessary.

### D4. Reconcile authored content early, and derive dispositions only in composition

Extend the pre-materialization boundary in `resolveAll`, adjacent to `reconcileLockedAgainstPlan`. Pass the previous document's exact version along with the entry; an entry alone does not prove inventory availability. For a previous `0.4` entry whose facet integrity equals the verified resolution:

1. Compare locked authored names with all verified authored names, including omitted records.
2. Recompute each verified declaration's canonical fingerprint and compare it with the corresponding locked fingerprint.
3. Return a structured identity-set or fingerprint mismatch before composition, adapter planning, consent, cleanup, or transaction creation.

This SHALL run on warm-cache, cold-resolution, registry, git, and local-source reproduction alike. A legitimate new facet integrity permits a replacement inventory after normal verification. Legacy entries have no trusted per-server records to reconcile; fields named `servers` on those documents SHALL NOT be interpreted as inventory.

**Dispositions are not content.** This reconciliation SHALL NOT reject an ordinary install merely because the user changed an alias or omission. Those changes are accepted project intent; frozen consistency and removal applicability are the places that compare dispositions. Comparing them during content verification would prevent valid normal installs from updating intent.

After collision resolution, `compose.ts` SHALL construct `servers` from `plan.mcpServers.planned`, partitioned by facet and sorted by authored name. It SHALL NOT construct inventory from active configurations, which omit records and combine origins. Every resolved facet receives an array, including `[]`. The existing atomic manifest/lockfile/receipt commit remains the only persistence point. Frozen operations continue returning the retained on-disk lockfile rather than claiming their composed `0.4` candidate was written.

**Alternatives:** Deriving records from adapter requests loses origins and omissions. Deriving them from receipts substitutes machine-local observations for complete authored content. Reconciliation after composition could silently overwrite a corrupted same-integrity inventory.

### D5. Separate pre-fetch frozen consistency from content verification

The existing coverage gate remains first. Format capability SHALL be expressed by exact supported sets, not `version !== 0.3` or numeric ordering:

| Loaded lockfile | Asset dispositions | Server overrides | Server inventory checks |
|---|---|---|---|
| `0.2` | Reject non-default intent | Reject before fetch | Content-derived reproduction when existing gates pass |
| `0.3` | Existing checks | Reject before fetch | Content-derived reproduction when existing gates pass |
| `0.4` | Existing checks | Compare with locked dispositions | Before fetch |

Asset-disposition capability SHALL be exactly `{0.3, 0.4}`; server-inventory/disposition capability SHALL be exactly `{0.4}`. An asset-only format refusal SHALL report `requiredVersion: 0.3`; a server-override refusal SHALL report `requiredVersion: 0.4`. These values identify representability, not the current writer. Recovery guidance SHALL explain that a normal installation writes `0.4`.

After coverage and format-capability checks, the `0.4` path SHALL call `planLockedServerInventory` with every locked authored name/fingerprint and the corresponding manifest overrides. Facets with empty inventories SHALL remain in the input so their stale overrides are reported. An absent override means authored, not “keep the locked alias.” The planner SHALL supply collisions, stale overrides, and planned dispositions; the engine SHALL compare those dispositions with the recorded ones. No synthetic lockfile or separate server stale-override sweep is needed.

Asset and server collisions SHALL be collected deterministically when they are in the same diagnostic category. Aliases can cause or cure collisions, but frozen mode SHALL reject departures from recorded dispositions. These checks precede `resolveAll`, including when receipts authorize cleanup.

After pre-fetch checks pass, resolution SHALL still verify facet integrity and run D4; native preparation and consent remain required. Delete `checkFrozenServerIntent` and its post-compose call: `0.4` stale server intent is covered before fetch, legacy formats with server overrides already refuse, and legacy formats without overrides cannot have stale server overrides. Legacy declaration collisions remain checked during composition. Content/record disagreements are reconciliation failures, not stale-intent failures. Neither shared file is migrated under frozen mode.

**Alternatives:** Fetching before checking `0.4` intent defeats the new offline diagnostic value. Trusting lockfile fingerprints instead of verifying declarations weakens integrity. Silently applying manifest intent over locked dispositions makes frozen results depend on an unrecorded choice.

### D6. Keep one writer version, with an explicit legacy-removal fallback

Successful non-frozen resolution SHALL write `0.4`. A legacy lockfile is an input format, never an output target. Migration populates the complete inventory from verified definitions; it does not infer an empty list from empty assets or from absent receipt claims.

For removal-only refinement:

- Before rebuilding remaining entries, check whether any facets remain and the previous document is `0.2` or `0.3`. If so, return `not-applicable` with `remaining-server-inventory-unavailable` and the observed version. Zero remaining facets skip this inventory-capability gate; existing receipt safety checks remain.
- For remaining `0.4` entries, carry complete inventories forward, including omissions, fingerprints, and extensions. Call `planLockedServerInventory` with the remaining facets' manifest overrides, and compare planned dispositions with locked dispositions. Collisions or disposition changes require ordinary resolution. Stale server overrides SHALL use the existing stale-intent reporting and transactional pruning path, without a second stale sweep.
- Preserve existing receipt witness checks and add agreement between each remaining facet's active locked records and its recorded configuration claims, in both directions, by authored name, disposition, and fingerprint. A missing active claim, unexpected claim, or mismatch SHALL require ordinary resolution. An omitted record has no receipt claim by design and SHALL NOT need one.
- Retained native configurations and deletion authority SHALL continue to come from witnessed receipt claims. The lock inventory can disqualify refinement; it cannot grant approval, create claims, or authorize deletion. Removing one of several identical claimants SHALL retain the configuration while any witnessed remaining claim wants it.
- If nothing remains, there is no remaining inventory to migrate or fetch. Existing receipt checks still govern cleanup; if refinement is unavailable, the ordinary path resolves an empty desired set. Neither route SHALL fetch removed facets merely to manufacture their discarded inventories.

Legacy fallback can require network access and can surface ordinary consent or native-state failures for retained facets. Failures SHALL leave project and adapter state uncommitted. Complete `0.4` refinement continues to avoid re-verifying content; it preserves historical records rather than claiming a fresh verification.

**Alternatives:** Writing `0.3` after upgrade introduces a second writer contract. Using receipts to fill legacy inventories misses omitted servers. Treating a lock fingerprint as receipt evidence would silently widen deletion and execution authority.

### D7. Preserve extensions without interpreting legacy lookalikes

Extend `preserveLockfileExtensions` to match retained `0.4` server records by authored name, with newly derived schema fields winning over old values. Preserve unrelated document, facet, source, asset, and file extensions under existing rules. Extensions on removed server identities disappear with those records. A disposition is carried as one existing tagged value, not a new independently versioned extension surface.

Only an old document tagged `0.4` supplies server-record extensions. On migration from `0.2` or `0.3`, a facet-level extension named `servers` SHALL be replaced by the verified canonical field; the implementation SHALL NOT examine its elements, even if they look like future records. This is the existing “schema-defined fields win” rule applied at the new field boundary.

Canonical construction SHALL copy only `name`, `fingerprint`, and `materialization` from planned servers, never spread declaration-bearing objects into a lock entry. Existing opaque extension preservation is not a secrecy filter; generated fingerprint-only inventory SHALL NOT be described as a guarantee that arbitrary user-authored extensions contain no literals. Public derivation exposes only the defined metadata.

The engine serializer SHALL retain sorted facet keys, deterministic server arrays, two-space JSON, and one trailing newline. Existing own-property-safe handling of facet keys such as `__proto__` SHALL extend to every new indexing path.

**Alternatives:** Generic shape-based merging of a legacy `servers` extension invents trust in data the old schema never defined. Dropping all extension data to simplify migration breaks the published preservation contract.

### D8. Return metadata-only failures and preserve CLI/SDK boundaries

Add `RECONCILE_SERVER_IDENTITY` with facet and sorted missing/unexpected authored names, and `RECONCILE_SERVER_FINGERPRINT` with facet, authored server name, expected locked fingerprint, and observed verified fingerprint. Match existing reconciliation orientation: missing means locked but absent from verified content; unexpected means verified but absent from the lock.

Use existing `LOCKFILE_DRIFT` for format-capability and stale-override failures, with `requiredVersion` as specified in D5. Add a `server-materialization-drift` arm carrying `name` (facet), `authoredName`, `manifest`, and `locked` dispositions rather than pretending a server is an `AssetType`. Pre-fetch collisions need a metadata-only locked-collision failure carrying all groups; do not cast fingerprint-only members to declaration-bearing `ServerCollisionGroup`. The CLI SHALL render facet/authored/effective identities and fingerprints without fetching declarations to enrich a report.

The removal fallback reason SHALL remain available as structured context when resolution fails, so CLI guidance can explain that verified migration is needed while retaining the actual underlying acquisition or integrity failure. Do not catch every error and replace it with a generic migration message, and do not stringify nested errors for later parsing.

Diagnostics SHALL distinguish recoveries: normal installation migrates legacy formats or records deliberate intent changes; same-integrity inventory corruption requires reviewing/restoring the inconsistent lockfile rather than promising a normal install will silently fix it. Approval failures continue to point to the unchanged consent workflow. No new CLI flag, adapter request field, receipt schema, or declaration logging surface is introduced.

**Alternatives:** Fabricated declaration objects keep old renderer types compiling but make diagnostics dishonest. A new SDK contract is unnecessary because consumers already have portable declaration values and obtain origins from public locked metadata.

## Validation Strategy

Implementation SHALL extend existing tests rather than treat all old `0.3` fixtures as current-format fixtures. Preserve explicit legacy cases and move current-writer helpers to `0.4` with required server arrays.

| Area | Required evidence |
|---|---|
| Schema and dispatch | Exact `0.2`/`0.3`/`0.4` reading; required empty arrays; sorted unique authored names; valid fingerprints and dispositions; duplicate JSON-member rejection; malformed `0.4` never falls back. |
| Public inventory | Server-only and mixed facets; aliases, swaps, omissions, all-omitted inventories; identical declarations retain all origins including two authored names from one facet; different fingerprints conflict; equal fingerprints at distinct identities stay separate; legacy lookalike fields do not enable inventory. |
| Planning equivalence | Declaration planning and locked-record derivation produce equal selected identities, fingerprints, and claimant membership for the same intent, independent of facet/server order; no mutable input structures escape. |
| Verified reproduction | Missing, extra, and changed fingerprints, including omitted records, fail before adapter planning, consent, cleanup, and writes on warm and cold paths; legitimate content updates and non-frozen alias/omission changes succeed. |
| Frozen matrix | `0.4` stale intent, collision, and disposition drift cause zero facet-fetch calls and zero mutations; legacy server overrides refuse early; legacy default server intent still reproduces; valid metadata does not bypass later integrity, native-state, or consent failures. |
| Migration and extensions | Both legacy versions migrate only with verified content; canonical `servers` replaces legacy extension lookalikes; `0.4` record extensions survive matching identities; removed-record extensions disappear; transaction failures restore all project/native state. |
| Removal | Legacy remaining facets force resolution; current complete inventory refines without fetch; receipt disagreement forces fallback; shared active identities survive one origin's removal; omitted records persist without claims; removing all facets fetches none even with missing or legacy receipt state. |
| Consumer and boundaries | Recompute fingerprints from actual portable exports and detect missing/unexpected/changed entries using only public symbols; Node 22+ published-entrypoint execution with Bun unavailable; no private cache, archives, server launch, or network; unchanged SDK/consent/takeover/deletion tests. |

Additional regression tests SHALL pin the independent encoding constants and canonical vectors; prove asset aliases remain accepted under both `0.3` and `0.4`; and assert asset-only versus server format-refusal versions. Generated fixture permutations SHALL compare both planner wrappers' planned dispositions, selected identities, claimant membership, collision groups, invalid-alias problems, and stale overrides, excluding declaration payloads. Derivation tests SHALL retain complete authored inventory, including omissions, on success and collision while returning no partial selected set on collision. Public-consumer negative cases SHALL include changed argument order, missing servers, and unexpected servers.

Relevant suites include protocol `lockfile-versions.test.ts`, `lockfile-extensions.test.ts`, `mcp-server.test.ts`, and `mcp-archive.test.ts`; engine `compose.test.ts`, `manifest-transaction.test.ts`, `refine-removal.test.ts`, `run-install.test.ts`, `run-remove.test.ts`, and `mcp-install.test.ts`; and CLI `collision.e2e.test.ts` and `mcp-consent.e2e.test.ts`. Update discovery and dry-run tests SHALL confirm those commands read `0.4` without migrating files or resolving declarations merely to inspect versions.

Public-consumer source tests SHALL import protocol's public index, not private modules. Built-output Node tests SHALL be named `*.e2e.test.ts` and wired into a protocol `test:e2e` script with an explicit build; protocol's unit script SHALL exclude them. This preserves the repository rule that ordinary unit tests and typechecks do not require build output. Targeted package tests and `bun check` are implementation verification, not part of authoring this design.

## Documentation Changes

The following updates are required to remove contradictions with the approved contract:

- `docs/specification/lockfile.mdx`: `0.4` examples and reader/writer versions; server record schema, ordering, fingerprint encoding binding, extension migration, and replacement of the “Why MCP did not move the lockfile” claims. Preserve or redirect its existing anchor because other pages link to it.
- `docs/specification/materialization.mdx`: omitted servers now retain locked inventory; unchanged naming, composition, and approval semantics remain canonical here.
- `docs/specification/install.mdx`: distinguish pre-fetch locked-inventory/intent gates from verified-content reconciliation and native checks; document the exact legacy matrix and removal migration exception.
- `docs/cli/install.mdx`: legacy server-override refusal, migration guidance, stronger frozen checks, and metadata-corruption recovery. Consent guidance stays unchanged.
- `docs/cli/remove.mdx:67`: explain the one-time verified-resolution fallback when remaining legacy entries lack inventory, its possible network/approval cost, and the no-remaining-content case.
- `docs/guides/install-facets.mdx`: update the current lockfile example to `0.4` with complete server arrays; link to the canonical migration behavior rather than restating it.
- Add a focused public API reference at `docs/reference/lockfile-inventory.mdx` and its navigation entry. It SHALL document parsing, unavailable/conflict results, output provenance, and a small consumer-owned derive/fingerprint/set-comparison example, clearly separating locked selection from successful native installation. The specification page SHALL link to this API reference rather than duplicate its signatures.

Documentation tasks SHALL explicitly replace the materialization claim “An omitted server leaves no lockfile trace”; update the install specification's Format capability, Plan over the locked set, Stale intent, and Intent against recorded disposition steps; and split the “MCP adds its own pre-mutation gates” paragraph between pre-fetch metadata checks and later content/native checks. CLI install documentation SHALL replace the claim that server overrides never cause legacy-format refusal and generalize the `0.2` override troubleshooting entry. The lockfile page SHALL explain that fingerprints derive from complete portable declaration values, including literal environment values, and are not secrecy guarantees. The API reference SHALL distinguish recorded derivation from override-aware planning and document the `authored` and selected views separately.

`README.md:16` promises reproducibility without naming a lockfile schema, and its approval/ownership claims remain accurate; no README edit is required. The fingerprint definition in `docs/specification/manifest.mdx`, stale-override guidance in `docs/cli/add.mdx`, and the Adapter SDK reference keep their current semantics. Historical changelog entries SHALL NOT be rewritten; release notes SHALL describe the new behavior instead.

## Risks / Trade-offs

- **A lockfile is a trust input, not an independent content proof.** → Derive new records only from verified definitions; reconcile on reproduction; document what offline comparison proves. Removal refinement preserves evidence rather than freshly verifying it.
- **Stronger legacy behavior can break CI or make the first removal need content.** → Keep old readers, give explicit migration guidance, and test both refusal and preserved default-intent reproduction.
- **Two planning routes could diverge.** → Share the server-claim core, avoid synthetic lockfiles and invented declarations, and test wrapper/derivation equivalence across success and failure outcomes.
- **Ordinary intent edits could be misclassified as tampering.** → Keep content reconciliation separate from disposition checks; test legitimate normal aliases/omissions at unchanged facet integrity.
- **A schema capability check could accidentally disable `0.4` asset overrides.** → Replace the old `version !== 0.3` assumption with exact per-feature supported sets, not numeric comparisons.
- **Committed declaration fingerprints can enable offline guessing.** → A digest over an isolated declaration can reveal low-entropy environment values when the other fields are known, particularly for previously private local-source definitions. Document this exposure and keep secrets out of declarations. Literal-string validation does not detect secrets. Keep the existing source-independent fingerprint unchanged; omitting environment values, salting by source, or introducing redaction would break complete-value verification and reproducibility. Opaque extensions remain outside any secrecy guarantee.
- **Broad current-type changes create misleading fixture failures.** → Explicitly distinguish historical fixtures from current-writer fixtures and leave archive, manifest, receipt, and Adapter SDK API version axes alone.
- **A syntactically valid hand-merge can introduce server conflicts.** → Return complete authored inventory and all collision members, but no selected winner or partial selected set; frozen checks fail before fetch.
- **An older CLI cannot read a committed `0.4` lockfile.** → Upgrade collaborators before sharing it; rollback restores the corresponding committed manifest/lockfile pair, not a rewritten version label or deleted lockfile.

## Migration Plan

1. Release protocol's explicit `0.4` reader/writer types and public derivation and fingerprint-only planner together with the CLI/engine implementation, tests, documentation, and release notes. Apply the project's pre-1.0 breaking-release discipline; no Adapter SDK API bump is involved.
2. Upgrade participating CLI installations before committing a `0.4` lockfile. Run a normal installation with the existing consent policy to verify definitions and transactionally populate inventories. Review and commit the resulting project files. Legacy frozen runs with server overrides require this migration; legacy no-override reproduction remains supported.
3. Preserve the one-current-writer policy on every successful non-frozen path, including removal. Do not mutate lockfiles during version discovery or dry-run operations. Existing snapshot/precondition checks continue to prevent applying a plan against project files that changed while it was reviewed.
4. On failure, retain existing transaction rollback semantics. To roll back a deployed format change to an older CLI, restore the corresponding previously committed manifest/lockfile pair rather than editing the version number or deleting integrity records. There is no automatic downgrade writer. Receipts remain machine-local and their authority SHALL NOT be manufactured from restored lock metadata.

## Open Questions

No blocking product decisions remain. This reconciliation explicitly selects separate derivation and intent-planning APIs, complete authored output, capability-based `requiredVersion` values (`0.3` for asset-only refusal; `0.4` for server refusal), and documentation-only treatment of fingerprint disclosure without changing the encoding. Comparison remains consumer-owned and consent/ownership remain unchanged. Implementation findings that require changing these boundaries SHALL require an explicit design revision.
