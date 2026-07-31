## Context

Installation currently resolves, verifies, and materializes one facet before resolving the next. That structure means the complete desired asset set does not exist before the first adapter write, so cross-facet collisions cannot be detected transactionally. The same authored asset `name` is also used for two different identities: canonical archive paths and integrity checks, and the adapter-facing name written on disk. Aliasing requires those identities to diverge without weakening verification.

The project has two materialization namespaces: skills and commands share one namespace, while agents occupy another. All current assets are project-scoped, but scope is already part of the lockfile identity and MUST remain part of collision keys. The same effective set is applied to every selected adapter.

The existing transaction model remains load-bearing: `facets.json`, `facets.lock`, and the machine-local receipt commit together; adapter writes are journaled; and handled failures return structured values. The design also preserves the protocol/engine/CLI layering: protocol owns artifact schemas and pure normative rules, engine owns installation and adapter I/O, and CLI owns TTY detection and prompts.

## Goals / Non-Goals

**Goals:**

- Detect every collision in the complete desired set before any adapter mutation.
- Allow each colliding asset to remain authored, receive an alias, or be omitted, including alias-all and omit-all outcomes.
- Persist the effective choice as project intent and resolved state so installs are deterministic across machines and in CI.
- Keep archive identity, canonical paths, and integrity anchored to authored names while using effective names for adapter I/O.
- Make alias changes, omissions, updates, repairs, drift removal, and facet removal transactionally safe.
- Keep old compact `facets.json` entries valid and make older CLIs fail closed on projects that use the new representation.

**Non-Goals:**

- MCP server collisions and future asset types.
- Publisher-authored aliases, facet identity renaming, or changes to `facet.json` and archive layout.
- Per-adapter aliases, exclusions, or materialized sets.
- Automatic precedence, install-order winners, or heuristic renaming.
- Changing the adapter API or existing within-facet namespace validation behavior.
- Adding schema-format versions to `facet.json` or `server.json`; archive compatibility continues to be governed by the versioned build manifest.

## Decisions

### 1. Define one authored-to-materialized identity model in protocol

Protocol SHALL define the materialization disposition once and derive narrower uses from it:

```ts
type MaterializationDisposition =
  | { kind: 'authored' }
  | { kind: 'aliased'; as: string }
  | { kind: 'omitted' }

type ProjectAssetOverride = Exclude<
  MaterializationDisposition,
  { kind: 'authored' }
>

type MaterializedDisposition = Exclude<
  MaterializationDisposition,
  { kind: 'omitted' }
>
```

The CLI label **Keep** maps to `{ kind: "authored" }`. It is not persisted as an override because absence already means “use the authored name.” A collision cannot disappear merely because this default is applied: the complete effective set is always checked after all overrides are applied. Persisting only aliases and omissions avoids two spellings for the same state while still reproducing every resolved set.

Protocol SHALL also provide the single namespace mapping used by facet-manifest validation, build validation, and cross-facet planning:

- `skill` and `command` → `skill-command`
- `agent` → `agent`

Two distinct keys SHALL be used:

- A **collision key** of `(scope, namespace, portable effective name)` enforces logical namespace uniqueness.
- An **adapter key** of `(scope, type, effective name)` identifies the concrete asset read, written, or deleted through an adapter.

The portable name key SHALL use the existing normalization and case-folding rules used for portable archive collisions. Current names and aliases are already lowercase ASCII, while this also protects migration of legacy names.

**Alternative considered:** keep the namespace helper and planner in engine. Rejected because these are normative, pure rules that another conforming implementation MUST reproduce.

### 2. Version and widen `facets.json` with exact dispatch

This change SHALL introduce the first explicit project-manifest format version. The current schema SHALL use top-level `manifestVersion: 0.1`:

```json
{
  "manifestVersion": 0.1,
  "facets": {
    "facet-a": "1.*",
    "facet-b": {
      "source": "github:example/facet-b#main",
      "materialization": {
        "skills": {
          "review": { "kind": "aliased", "as": "facet-b-review" }
        },
        "commands": {
          "deploy": { "kind": "omitted" }
        }
      }
    }
  }
}
```

Project-manifest versioning SHALL remain independent from archive `facetVersion` and lockfile `lockfileVersion`; each format evolves on its own axis. Exact dispatch SHALL recognize:

- **Legacy unversioned:** no `manifestVersion`; every facet value MUST be a compact source string.
- **Current version 0.1:** `manifestVersion` is exactly numeric `0.1`; facet values MAY use compact strings or expanded entries.
- **Unsupported:** any other explicit value SHALL fail with structured data identifying the observed and supported versions. The loader SHALL NOT infer a declared version from the remaining shape or fall back to another schema after validation fails.

A successful normal add, install, update, or remove SHALL write current `manifestVersion: 0.1` as part of the transactional tri-write, including when the input was legacy unversioned and no materialization override exists. Frozen installation MAY read a valid legacy unversioned manifest but SHALL NOT migrate or rewrite it. An expanded entry in an unversioned document SHALL be rejected rather than reinterpreted as current.

Compact string entries remain canonical when no override exists. A current-version facet with overrides uses the expanded form shown above. The `materialization` object MAY contain `skills`, `commands`, and `agents` maps. Keys identify authored assets; map values are the `aliased` or `omitted` arms only. Maps avoid duplicate typed asset records, and nesting avoids inventing a parseable `type:name` string grammar. Alias values MUST satisfy the current single-segment asset-name grammar. Authored keys SHALL use the path-safe asset-name grammar so legacy assets remain addressable.

An expanded entry MUST contain at least one override. The canonical writer SHALL collapse an empty expanded entry back to its source string while retaining `manifestVersion: 0.1`. Updating or re-adding a facet SHALL change only `source` and preserve its overrides. Parsing SHALL reject duplicate JSON members before version dispatch and schema validation so duplicate decisions cannot collapse through parser-specific last-member-wins behavior.

The project-manifest mutation inventory is `packages/engine/src/manifest/mutations.ts`, `packages/engine/src/manifest/project-files.ts`, `packages/engine/src/install/commit/delta.ts`, and `packages/engine/src/install/commit/tri-write.ts`. Every path SHALL preserve `manifestVersion` and expanded entries for untouched facets, and source updates SHALL preserve the target facet's materialization overrides. Read-only consumers such as `facet list` SHALL obtain the source from either entry form. `packages/engine/src/edit/` writes author-side `facet.json`, not project `facets.json`, so it requires no expanded project-entry preservation change.

Previously released CLIs may ignore the unknown top-level `manifestVersion` field. They still fail closed on alias-bearing projects because their schema requires every facet value to be a string and rejects expanded entries before acquiring the install lock. Current and future readers gain explicit dispatch, migration, and unsupported-version diagnostics.

Overrides remain active even when the original collision disappears. An alias or omission is project intent and SHALL NOT be silently removed merely because another facet was removed. If an override references an authored asset absent from the resolved facet version, a normal install SHALL report it and prune it only as part of a successful tri-write; a frozen install SHALL report manifest/lockfile drift and perform no write. Each automatic prune SHALL emit a dedicated structured stage event identifying the facet, asset type, and authored name; it SHALL NOT be visible only through verbose logging.

**Alternatives considered:**

- Continue distinguishing project-manifest generations only by entry shape. Rejected because shape inference provides no explicit compatibility axis or unsupported-version diagnostic.
- Version `facet.json` and `server.json` in the same change. Rejected because their compatibility contracts are independent from consumer-side materialization, and archive compatibility is already dispatched through the build manifest.

### 3. Introduce lockfile and receipt version `0.3`

Lockfile `0.3` SHALL retain `name` as the authored name and add a required `materialization` disposition to every asset. Its `files` array SHALL continue to contain canonical authored inner-archive paths and per-file hashes, including for an omitted asset. This keeps reconciliation and integrity independent from where, or whether, an asset is materialized.

```json
{
  "scope": "project",
  "type": "skill",
  "name": "review",
  "materialization": { "kind": "aliased", "as": "facet-b-review" },
  "files": [
    {
      "path": "skills/review/SKILL.md",
      "integrity": "sha256:..."
    }
  ]
}
```

Exact version dispatch SHALL recognize legacy alpha `1`, previous `0.2`, and current `0.3`; it SHALL NOT infer a version from shape. Normal installation can losslessly refine every older asset to `{ kind: "authored" }` and write `0.3` after verification. Frozen installation SHALL NOT migrate.

Every successful non-frozen install SHALL write lockfile `0.3`, even when the project has no materialization overrides. This follows the existing migration policy, keeps one canonical current writer schema, and prevents format oscillation. The compatibility cost is deliberate: the first successful normal install with a supporting CLI makes the lockfile unreadable to older CLIs even for a resolution-free project.

Receipt `0.3` SHALL record authored `name`, authored owned-file paths, and a `MaterializedDisposition` for each asset actually present on disk. Omitted assets SHALL be absent from the receipt. This makes an “omitted but materialized” receipt state unrepresentable while retaining both names needed for offline deletion. Receipt `1` and `0.2` assets refine to authored materialization during load.

Archive, build-manifest, and adapter API versions do not change. Archive bytes and adapter request shapes remain unchanged.

**Alternatives considered:**

- Reuse `name` for the alias and add an authored name. Rejected because canonical paths and integrity are authored-domain data, so the existing meaning of `name` remains the stable anchor.
- Add an optional alias beside `name`. Rejected because optional fields would encode the disposition indirectly and permit inconsistent combinations with omission.
- Drop omitted assets from the lockfile. Rejected because the lockfile must record the resolved asset set and compare it with project intent; only the machine-local receipt excludes non-materialized assets.
- Preserve `0.2` while no overrides exist and write `0.3` only after a project uses aliasing or omission. Rejected because it creates a bimodal serializer, permits `0.2`/`0.3` oscillation as overrides come and go, and leaves two writable “current” shapes. It would narrow the compatibility break to participating projects, but the selected design prioritizes one canonical format and the established migrate-forward policy.

### 4. Resolve materialization with one deterministic pure planner

Protocol SHALL expose a pure planner over resolved authored contributions plus normalized project overrides. It SHALL:

1. Sort facets and assets deterministically using code-unit ordering and the existing asset-type order.
2. Match overrides to `(facet, type, authored name)` and validate alias names.
3. Derive one disposition and effective name for every authored asset.
4. Exclude omitted assets from the effective set.
5. Group the remaining assets by collision key and return every group with two or more members.
6. Return a materialization plan only when the effective set is collision-free.

Collision results SHALL carry structured member data: facet, scope, type, authored name, effective name, and current disposition. Groups and members SHALL be deterministically ordered. All groups SHALL be reported in one pass rather than forcing users through repeated install attempts.

The same planner SHALL support live evaluation of an in-progress resolution draft. A draft MAY remain temporarily colliding; the planner returns every linked collision group and member rather than discarding the choices. The CLI uses those results for live status, and the engine uses the same planner for final defense-in-depth validation. A materialization plan is returned only for a collision-free draft.

The planner applies aliases once against authored identity, then checks the resulting set once. It is not an ordering-dependent or fixed-point resolver. Alias swaps are valid; duplicate alias targets fail; a skill may share an effective name with an agent but not with a skill or command; and omitting every member is valid. Skill companions never participate independently and follow their owning skill's disposition.

### 5. Split installation into resolve, compose, and apply phases

The existing interleaved install loop SHALL become five explicit phases, each with ordered substeps.

#### Phase 1: Preflight

1. **Load project intent:** read `facets.json`, reject duplicate members, dispatch its exact manifest version, and normalize legacy/current compact and expanded entries.
2. **Acquire project lock:** acquire the install lock before reading mutable locked or receipt state.
3. **Load resolved and machine state:** exact-dispatch `facets.lock`; load the receipt or bootstrap it from the lockfile; report and skip unsafe receipt entries.
4. **Validate invocation:** reject conflicting additions/removals and incompatible selected adapters.
5. **Merge desired intent:** apply additions and removals to an in-memory project manifest without writing it.
6. **Run frozen gates:** reject frozen deltas and detect manifest/lockfile source, version, materialization, orphan, and stale-override drift before any receipt cleanup.
7. **Start progress:** emit the install-start event with the complete desired facet count.

#### Phase 2: Resolve all

For each desired facet, in deterministic order:

1. **Parse intent:** extract the source specifier and persisted materialization overrides.
2. **Select resolution path:** determine whether to use a satisfying locked entry or perform fresh registry, Git, or local resolution.
3. **Acquire content:** use the audited cache, download, clone, or build as required by the source.
4. **Verify integrity:** verify facet-level and per-file integrity before trusting content.
5. **Load authored content:** load `facet.json`, resolve authored prompt bodies, and capture companion bytes.
6. **Derive authored plan:** produce canonical authored asset identities, paths, hashes, and ownership.
7. **Reconcile locked state:** compare previous authored lock state with the verified plan.
8. **Accumulate:** retain the complete resolved record for Compose.

No adapter method SHALL be invoked during Resolve all. The resolved record SHALL use a tagged union for “fresh verified plan with companion bytes” versus “inherited locked entry,” replacing the current parallel optional fields.

#### Phase 3: Compose

1. **Normalize contributions:** deterministically order every resolved facet and authored asset.
2. **Apply persisted intent:** match aliases and omissions to authored identities; diagnose stale overrides.
3. **Derive effective identities:** retain authored names for integrity while computing each materialized asset's effective name and excluding omitted assets.
4. **Detect collisions:** group the complete effective set by logical collision key and collect every unresolved group.
5. **Resolve interactively or fail:** in frozen or non-interactive mode, return structured no-mutation failure; otherwise open one typed CLI resolution workspace over the complete authored set and current overrides.
6. **Validate the workspace:** evaluate every in-session edit with the pure planner, permit temporary draft collisions, and accept only a collision-free final choice map or cancellation. After the resolver returns, the engine SHALL run one final defense-in-depth validation and SHALL NOT reopen the resolver automatically.
7. **Build global plan:** produce per-facet lockfile dispositions, the collision-free materialization set, retained adapter keys, and effective ownership needed by Apply.

No journal SHALL exist during Compose. No project file or adapter state SHALL be written.

#### Phase 4: Apply

1. **Create journal:** create the rollback journal only after Compose returns a collision-free plan.
2. **Index previous ownership:** derive old effective adapter keys from the receipt, with lockfile-bootstrap state as the fallback, and aggregate duplicate historical claims and companion ownership.
3. **Plan deletions:** identify each old adapter key absent from the desired set; retain any key still claimed by a desired asset.
4. **Delete obsolete assets:** delete each obsolete key exactly once across every selected adapter and journal its complete prior bundle.
5. **Materialize desired assets:** read, compare, and install every non-omitted asset under its effective name, carrying authored content and companion ownership.
6. **Repair or skip:** skip byte-identical assets; repair drifted primary or companion content; journal every mutation.
7. **Finalize outcomes:** classify installed, updated, repaired, unchanged, and removed facets and record obsolete receipt ownership for removal.
8. **Handle failure or cancellation:** convert handled failures to structured results and replay the journal before returning.

#### Phase 5: Commit

1. **Finalize project intent:** apply source write policy, merge approved collision choices, prune reported stale overrides, and canonicalize empty expanded entries.
2. **Build lockfile:** construct lockfile `0.3` with every authored asset, its materialization disposition, canonical authored paths, and integrity records.
3. **Build receipt:** construct receipt `0.3` from assets actually materialized, excluding omitted assets and removed ownership.
4. **Respect frozen mode:** leave `facets.json` and `facets.lock` byte-for-byte unchanged and write only the machine-local receipt.
5. **Capture pre-images:** for a normal operation, capture manifest, lockfile, and receipt bytes immediately before the first project-state write.
6. **Tri-write:** atomically write `facets.json`, `facets.lock`, and the receipt; restore every pre-image if any write fails.
7. **Complete:** emit final progress and summary data, then release the project lock through the existing `finally` boundary.

The substeps make mutation and identity boundaries explicit; they do not require a separate all-facets barrier for every substep. In particular, each facet MAY complete all Resolve-all substeps before the next facet begins. The load-bearing global barrier is between Resolve all and Compose: every desired facet MUST have verified authored state before materialization overrides are applied.

Compose is the sole authored-to-effective transformation. Resolution and integrity verification SHALL NOT observe aliases. Compose SHALL preserve verified authored plans, derive a separate effective materialization plan, and keep newly collected choices in memory until Commit persists them transactionally.

Resolved prompt and companion bytes remain eagerly held through compose. This increases peak memory from the largest facet to the complete desired set, but avoids a time-of-check/time-of-use gap for local sources and requires no cache-lifetime redesign.

The initial implementation SHALL NOT introduce a bounded-memory threshold, disk spilling, or a durable-versus-volatile content split. Facets are expected to remain small and are normally added incrementally; the collision planner itself consumes asset metadata and runs as soon as the complete desired asset plan is available, before journal creation or materialization. Eager companion bytes remain the simpler correctness choice for local-source time-of-check/time-of-use safety. Memory-specific machinery MAY be reconsidered only if production measurements demonstrate a real problem.

The project install lock remains held across all phases, including an interactive resolution prompt. Releasing it would require re-resolving or inventing a second staleness protocol before commit. The journal starts only after a collision-free plan exists, so cancellation or collision failure requires no rollback.

`facet remove` SHALL run through the same resolve-and-compose gate without a special case. Because removal only shrinks the desired contribution set, it cannot introduce a new collision, while the shared path still validates remaining persisted overrides and ownership.

**Alternatives considered:**

- Dry-run the existing loop and run it again. Rejected because it repeats resolution/build work and represents mutation behavior with a mode flag.
- Detect from the old lockfile before resolution. Rejected because new versions can introduce assets and collisions.
- Detect inside adapters. Rejected because it is ordering-dependent, adapter-specific, and occurs after mutation begins.

### 6. Let CLI resolve collisions through a typed engine callback

Normal installation MAY receive an optional async collision resolver. The engine provides the complete authored contribution set and current in-memory overrides as one resolution workspace. The resolver returns either a collision-free typed choice map or a cancellation value. Expected cancellation is a value, not a thrown error.

The resolver SHALL evaluate the full draft with the pure protocol planner after every Keep, Alias, or Omit edit. It MAY retain temporarily colliding choices so users can revisit either side of a conflict, but it SHALL NOT return a resolved result until the complete draft is collision-free. The engine SHALL validate the returned map once as defense-in-depth; an invalid callback result becomes a structured no-mutation failure rather than causing the resolver to reopen.

If no resolver is supplied, installation SHALL return a structured materialization-collision failure containing every group. Frozen installation SHALL never invoke the resolver; unresolved collisions fail on the no-mutation path. The CLI supplies the resolver only for an interactive TTY.

Non-interactive failure rendering SHALL identify the exact expanded-entry locations to edit and show valid alias and omit snippets for each claimant. It SHALL NOT synthesize a complete resolution, select a winner, or derive aliases heuristically.

`InstallView` SHALL implement a phase machine inside its existing Ink mount: progress → collision-resolution workspace → progress → result. It SHALL NOT start a nested Ink renderer. The workspace uses the shared planner and asset-name validator for live global validation. SIGINT or cancellation resolves the callback as cancelled, after which `runInstall` releases the lock through its existing `finally` path.

Choices are held in memory and folded into the normalized project manifest only after the planner accepts them. They reach disk solely through the final tri-write, so a later verification, adapter, or write failure leaves the committed project intent unchanged.

The initial release SHALL NOT add non-interactive resolution flags. CI and automation SHALL record durable intent by editing and committing `facets.json`; pipeline-only flags would duplicate the project manifest as a source of truth.

**Alternatives considered:**

- Return an in-process resumable handle. Rejected because it exposes lock/resource lifecycle and consumed-handle states to the CLI without improving the transaction.
- Return a collision failure, prompt, and run installation again. Rejected because local facets rebuild and all facets re-verify, and users see the progress flow twice.
- Write choices to `facets.json` before rerunning. Rejected because it violates the transactional manifest-write policy.

### 7. Resolve one collision group at a time

The initial TUI SHALL treat one collision group as the focused unit of work while maintaining one global in-memory resolution draft. When several groups exist, it SHALL present an overview of all affected assets and their live status. Selecting an item opens a focused view showing its claimant assets and current dispositions; the view MAY support asset-content previews without making previews a prerequisite for the initial implementation.

Each affected item SHALL display one of three semantic states, using labels or icons in addition to color:

- **Red — unresolved:** the original or persisted effective set still contains a collision not yet addressed.
- **Yellow — draft conflict:** current in-session choices collide with another proposed alias or effective asset. Every claimant in the linked draft collision SHALL be yellow and mutually navigable.
- **Green — resolved:** the current effective identity is unique across the complete draft set.

Within the focused view, every Keep, Alias, or Omit edit SHALL update the global draft immediately and rerun the pure planner. The UI SHALL allow a user to retain a yellow alias temporarily, return to the overview, follow its linked claimant, and revise either side. For example, if a green item is later targeted by another proposed alias, both items become yellow; once either receives a unique effective name, both are reevaluated and may become green.

Installation resumes only when every affected item is green and the engine's final validation accepts the complete choice map.

The initial release SHALL NOT provide a bulk editor that modifies several collision groups simultaneously. Multi-group handling SHALL be orchestration around the same focused single-group component, keeping the single-collision experience as the source of truth.

**Alternative considered:** edit every collision group on one screen and submit them together. Rejected because it combines navigation, validation, previews, and multiple independent decisions into one complex interaction before the single-group workflow is proven.

### 8. Apply ownership globally using effective adapter identities

The apply phase SHALL derive old ownership primarily from the receipt, with lockfile bootstrap as today, and new ownership from the composed plan. It SHALL index ownership by adapter key, separately from logical collision keys.

For each selected adapter, apply performs two deterministic passes:

1. Delete each old adapter key absent from the new set exactly once.
2. Materialize every non-omitted planned asset under its effective name.

An old key retained by any desired asset SHALL NOT be deleted, even when ownership transfers between facets. The replacement write uses the union of recorded old companion ownership for that adapter key, preventing historical duplicate receipt claims from deleting a surviving asset or leaving stale companions. Every delete and write remains journaled.

Content, descriptions, adapter metadata lookup, companion extraction, reconciliation, and integrity use the authored name. Adapter read/install/delete requests and generated front-matter `name` use the effective name. A skill's companion paths are stripped relative to its authored archive directory and then installed beneath its effective directory.

Changing an alias becomes delete-old plus write-new; changing to omitted deletes the old effective asset; removing omission writes the new effective asset. A materialization-disposition change at the same facet version SHALL classify the facet as updated, while a disk-only repair remains repaired.

## Risks / Trade-offs

- **[Peak memory grows with the complete desired set]** → Keep eager bytes for correctness in the first implementation; measure real projects before introducing a tagged durable-versus-volatile lazy-read optimization.
- **[The project lock is held while a user decides]** → Display that installation is awaiting collision resolution, honor cancellation promptly, and rely on existing stale-lock recovery after process death.
- **[The first upgraded install may expose collisions that were previously silent]** → Fail before writes with every claimant listed and offer the interactive resolver when available.
- **[Manifest and lockfile evolution expands compatibility logic]** → Use exact three-version dispatch, version-stamped schema names, and fixtures proving there is no shape fallback.
- **[A malformed or stale override could target the wrong asset]** → Validate authored keys and aliases, reject duplicate JSON members, prune absent-asset overrides only in a successful normal transaction, and fail frozen drift.
- **[An alias may break prompt text or external references that mention the authored name]** → Treat aliasing as placement identity only; document that content is not rewritten and users must choose aliases compatible with their workflows.
- **[Historical receipts may contain duplicate claims]** → Aggregate old ownership by effective adapter key and never delete a key retained by the new global plan.
- **[Third-party adapters may have undocumented assumptions about names]** → Keep the request shape unchanged, pass only names satisfying the existing grammar, and add adapter conformance coverage using aliased names.
- **[Resolving all facets before applying changes alters failure ordering and latency]** → Preserve deterministic facet ordering and first resolution failure for the initial implementation; collision collection itself remains exhaustive.

## Migration Plan

1. Add protocol namespace/disposition types, legacy-unversioned and current-version-`0.1` project-manifest schemas with exact dispatch, lockfile `0.3` schemas, and the pure planner. Existing lockfile `1` and `0.2` readers remain available.
2. Normalize legacy and current compact/expanded project entries at the engine load boundary. Update every project-manifest mutation and writer—`manifest/mutations.ts`, `manifest/project-files.ts`, `install/commit/delta.ts`, and `install/commit/tri-write.ts`—to preserve expanded entries, write `manifestVersion: 0.1`, and canonicalize empty expanded entries. Add exact-dispatch, migration, frozen-retention, preservation, add, update, install, remove, and `facet list` read-tolerance coverage.
3. Add receipt `0.3` and lossless `1`/`0.2` refinement to authored materialization. Omitted lockfile assets are filtered when bootstrapping a receipt.
4. Refactor installation into resolve/compose/apply and add global effective-ownership planning before enabling any writer to emit `0.3`.
5. Add structured engine failures and the CLI phase-machine resolver. Non-interactive and frozen paths remain fully usable without the callback and fail closed on unresolved groups.
6. Enable `0.3` writes only after protocol, engine, CLI, migration, rollback, and adapter tests pass together. A successful normal install performs lockfile and receipt migration in the existing transaction; a failed install writes no migrated state.

Downgrading is fail-closed: an old CLI rejects an expanded manifest value, and a CLI that accepts only `0.2` rejects a `0.3` lockfile. Because every successful normal install migrates forward, removing all overrides and reinstalling SHALL NOT downgrade the lockfile to `0.2`. Restoring `0.2` requires an explicit compatibility rollback after all aliased or omitted assets have been reconciled to authored materialization—for example, restoring the pre-migration lockfile from version control. Deleting only the new lockfile while aliased state remains on disk is not safe.

## Documentation Updates

The following user-facing documentation conflicts with or omits the new behavior and MUST be updated:

- `docs/specification/project-manifest.mdx`: compact/expanded entry schema, override semantics, validation, and write policy.
- `docs/specification/lockfile.mdx`: version `0.3`, authored paths, materialization dispositions, and exact dispatch.
- `docs/specification/install.mdx`, `docs/specification/planning.mdx`, and `docs/specification/commit.mdx`: global pre-write composition, prompt boundary, frozen behavior, receipt ownership, and tri-write.
- `docs/specification/manifest.mdx` and `docs/specification/terminology.mdx`: distinguish authored names, effective/materialized names, logical namespaces, aliases, and omissions.
- `docs/guides/install-facets.mdx` and `docs/guides/custom-adapters.mdx`: collision walkthrough, persisted examples, on-disk layout, and confirmation that adapters receive the effective name through the existing API.
- `docs/cli/add.mdx`, `docs/cli/install.mdx`, `docs/cli/instructions.mdx`, and `docs/guides/troubleshooting.mdx`: interactive choices, non-interactive failures, frozen guidance, and recovery.
- `docs/changelog/index.mdx`: user-visible format and install behavior change.

The root `README.md` was reviewed. Its quickstart and high-level statement that add resolves and installs in one step remain accurate, so no README change is required.
