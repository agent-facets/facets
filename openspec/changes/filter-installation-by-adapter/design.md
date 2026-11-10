## Context

`facet add`, `facet install`, and `facet remove` currently reconcile the complete desired project state into every installed materialization-capable adapter. The machine-local `0.4` receipt records adapter-agnostic project ownership: it identifies what the project may manage and delete, but does not record where each identity was written.

Leaving non-target adapters untouched would require adapter-scoped receipt history so filtered updates and removals could preserve old deletion evidence. The simpler model is to make an explicit adapter list exclusive: every non-target adapter is purged during the same operation, while every target adapter receives the complete desired project state. Because no successful operation leaves intentionally stale project-owned state in a discoverable non-target adapter, the existing adapter-agnostic receipt remains sufficient.

The manifest and lockfile remain project-wide desired state. The project lock, transaction journal, consent model, collision plan, and receipt format remain unchanged.

## Goals / Non-Goals

**Goals:**

- The three installation front doors MUST accept an optional, repeatable `--adapter <name>`.
- Explicit adapter values MUST resolve to a non-empty exclusive target set before mutation.
- Every successful filtered operation MUST remove all receipt-owned project materialization from every installed non-target materialization-capable adapter.
- Every successful filtered operation MUST reconcile the complete desired project state into every target adapter.
- Receipt schema `0.4` MUST remain the adapter-agnostic source of deletion authority.
- Target writes, non-target purges, manifest changes, lockfile changes, and receipt changes MUST remain transactional.
- Invocations without `--adapter` MUST retain existing behavior.

**Non-Goals:**

- This change SHALL NOT add project-level adapter configuration or a `facet configure` command. A future change MAY supply default targets from project configuration, with explicit CLI values taking precedence.
- This change SHALL NOT add per-facet placement, per-adapter desired versions, or adapter-scoped receipt ownership.
- This change SHALL NOT change the receipt version or add a receipt migration.
- This change SHALL NOT apply adapter targeting to authoring, build, publish, adapter-management, or read-only commands.
- This change SHALL NOT add comma-separated values, exclusion grammar, or an “all except” mode.
- This change SHALL NOT alter adapter SDK placement or MCP translation contracts.
- This change SHALL NOT guarantee removal from an adapter that is no longer installed or discoverable on the machine.

## Decisions

### 1. Parse repeatable adapter targets at the shared CLI boundary

`INSTALL_PIPELINE_FLAGS` SHALL define one array-valued `adapter` flag so `add`, `install`, and `remove` receive an identical repeatable option. `FlagDef` SHALL gain a value-label field so help renders each occurrence as `--adapter <name>`.

A pure parser SHALL produce:

```ts
type AdapterTargetRequest =
  | { kind: "all" }
  | { kind: "exclusive"; names: NonEmptyReadonlyArray<string> };
```

No flag SHALL produce `all`. One or more flags SHALL produce `exclusive`. Missing and empty values SHALL return typed usage failures, and duplicate names SHALL be deduplicated. These commands SHALL reject undeclared flags so a typo cannot silently widen the target set.

The target resolver SHALL operate on this source-independent request rather than reading argv itself. Today, absence of CLI values resolves to `all`. A future project configuration MAY provide an `exclusive` default request, while explicit CLI values override it, without changing the engine contract.

Semantic selection SHALL inspect the complete installed adapter set. A filtered invocation SHALL NOT launch the picker or implicitly install an adapter. Every requested target and every adapter that must be purged MUST load successfully and expose the capabilities required for its side of the transition. Any failure SHALL abort before the project lock or mutation and SHALL identify the affected adapter.

The current command ordering SHALL remain: `add` parses sources before adapter discovery, and `remove` validates project state before adapter discovery.

**Alternatives considered:** Comma-separated values were rejected because repeatable flags avoid another grammar. Persisted configuration was deferred to a separate change. Ignoring a broken non-target adapter was rejected because exclusive targeting cannot truthfully claim it was purged.

### 2. Represent target and purge sets as one tagged engine value

The engine SHALL receive one scope value:

```ts
type InstallationAdapterTargets =
  | {
      kind: "all";
      targets: NonEmptyReadonlyArray<Adapter>;
    }
  | {
      kind: "exclusive";
      targets: NonEmptyReadonlyArray<Adapter>;
      purge: readonly Adapter[];
    };
```

The CLI selection boundary SHALL construct and validate this partition. In the `exclusive` arm, `targets` and `purge` SHALL be disjoint and together SHALL cover every installed materialization-capable adapter participating in the operation. Only concrete, successfully loaded adapters reach the engine because both sets may be touched.

The engine SHALL derive target writes only from `targets` and full-project removal plans only from `purge`. The existing project-wide lock SHALL continue to serialize all operations because every invocation can modify the same manifest, lockfile, receipt, and adapter files.

**Alternative considered:** Passing target names and resolving purge adapters inside the engine was rejected because installed-adapter discovery and diagnostics are CLI responsibilities. Passing only targets was rejected because the engine could not prove that every non-target adapter had been purged.

### 3. Keep receipt ownership adapter-agnostic at schema `0.4`

The install receipt SHALL remain:

```ts
type Receipt = {
  version: 0.4;
  path: string;
  facets: Record<string, ReceiptFacetEntry>;
};
```

The receipt SHALL continue to answer “which identities and paths may this project manage?” rather than “which adapter currently contains each identity?” A filtered operation does not require adapter history because it removes all prior project-owned state from non-target adapters before committing the new project-wide account.

The committed receipt SHALL be derived from the complete desired project state successfully reconciled into the target set. Asking a purge adapter to remove a globally owned identity that is absent remains a safe no-op, matching existing adapter-agnostic semantics.

No receipt migration, forward refinement, adapter list, version partition, or downgrade policy is introduced.

**Alternatives considered:** Adapter-first snapshots, facet/version partitions, and per-asset adapter tags were rejected because exclusive target semantics prevent intentional stale ownership and make those dimensions unnecessary. Leaving non-target adapters untouched was rejected because it requires retaining per-adapter historical deletion evidence.

### 4. Purge non-target adapters and reconcile targets in one transaction

The engine SHALL complete all source resolution, desired-state composition, adapter compatibility checks, native-state planning, collision decisions, and consent before opening the mutation journal.

For an exclusive operation, the mutation plan SHALL contain two physical phases:

1. **Purge:** remove every receipt-owned asset and MCP configuration entry from every adapter in `purge`, regardless of whether the identity remains in project desired state.
2. **Target reconciliation:** remove obsolete target-owned identities and materialize the complete desired project state into every adapter in `targets`.

Both phases SHALL use the existing receipt as their only deletion authority. Purging MUST NOT scan for or delete untracked native files. Purge and target transitions SHALL participate in the same transaction, and any failure SHALL roll back both phases byte-exactly.

`facet add` and `facet remove` SHALL commit project manifest, lockfile, and receipt changes through the existing tri-write after physical reconciliation succeeds. `facet install` SHALL retain current manifest/lockfile behavior.

**Alternative considered:** Purging only facets changed by the command was rejected because it retains implicit per-facet placement and requires state-change detection. Purging the complete project account makes the target set exact and keeps the receipt model uniform.

### 5. Reconcile the complete project state into every target

Adapter targeting SHALL affect physical placement, not desired-state composition. Manifest mutation, lockfile generation, integrity, effective-name collision planning, aliases, omissions, and stale-override pruning SHALL remain project-wide.

Every target adapter SHALL receive the complete materialized set after an `add`, `install`, or `remove` operation. The named facet is not the only item reconciled. Consequently:

- `facet add cowsay --adapter opencode` purges the project account from non-target adapters and reconciles all desired facets, including `cowsay`, into OpenCode.
- `facet remove cowsay --adapter opencode` purges the project account from non-target adapters, removes `cowsay` from project desired state, and reconciles every remaining facet into OpenCode.
- A later unfiltered `facet install` reconciles the complete project state into every installed materialization-capable adapter again.

Project-content collisions SHALL remain global. Native occupancy and takeover checks SHALL evaluate target adapters. Purge adapters SHALL use receipt authority and SHALL NOT require takeover decisions because they never adopt untracked files.

### 6. Purge MCP ownership without narrowing consent

Each purge adapter SHALL receive removal authority only for effective MCP server names claimed by the adapter-agnostic receipt. The purge phase SHALL remove those entries before target MCP application.

Target adapters SHALL perform existing MCP support, native-document overlap, takeover, and consent checks. Declaration approval SHALL remain machine-wide identity-and-fingerprint evidence from the receipt. Filtering SHALL neither manufacture approval nor require approval again merely because the target set changed.

When purge and target adapters address the same native document, their planned transitions SHALL compose in purge-then-target order inside the transaction. If the adapter plans cannot be composed safely, the operation MUST return a typed pre-commit failure rather than partially mutating the document.

`--accept-mcp`, interactive consent, and frozen-mode consent behavior SHALL remain unchanged.

### 7. Treat every successful filtered result as converged

A successful filtered operation SHALL have one stable postcondition:

- every target adapter reflects complete project desired state;
- every discoverable purge adapter contains no receipt-owned project state.

There is no deferred reconciliation state and no adapter-specific catch-up metadata. A later operation simply applies its own target/purge partition. An unfiltered operation targets every installed materialization-capable adapter and purges none.

The existing adapter-agnostic removal-refinement path SHALL be disabled globally rather than expanded to prove role-aware target/purge transitions. Every removal SHALL resolve complete remaining target state before mutation, using cached content when available and source/network resolution on cache miss. This intentionally changes the execution strategy for unfiltered removal: a cold-cache invocation without source availability SHALL fail unchanged instead of completing through receipt-only refinement. Target selection, placement postconditions, and receipt-driven deletion authority remain unchanged.

### 8. Report exclusive target and purge effects explicitly

Install summaries SHALL carry a tagged scope summary containing every target adapter and, for exclusive operations, every purged adapter. Filtered headers and success summaries SHALL use exclusive language such as:

```text
Targets: opencode, claude-code
Purged: codex
```

Help text and command documentation MUST state that non-target adapters lose all Facet-managed project assets and MCP entries. Failure remedies SHALL preserve every repeated `--adapter <name>` occurrence so suggested reruns do not widen scope.

Facet outcomes remain project outcomes because manifest and lockfile state are project-wide. Physical counts SHALL include target writes and purge removals separately.

No additional confirmation prompt is introduced: the explicit flag is usable in non-interactive and frozen workflows. The CLI MUST make the destructive scope visible before mutation when a rendered progress view is active and MUST repeat it in the final summary.

### 9. Permit exclusive targeting in frozen lockfile mode

`facet install --frozen-lockfile` SHALL permit one or more repeated `--adapter <name>` targets. Frozen mode constrains the project-wide locked set, while adapter targeting controls physical placement.

Frozen consistency gates and all target/purge preflight SHALL complete before mutation. A successful run SHALL purge every non-target adapter, reconcile the locked set into every target adapter, leave manifest and lockfile bytes unchanged, and write the existing adapter-agnostic receipt through the current receipt-only frozen commit.

Interactive decisions SHALL remain unavailable. The receipt-unpersisted outcome SHALL report the target and purge sets because failed receipt persistence leaves physical changes without refreshed ownership evidence.

### 10. Update affected documentation with the implementation

The CLI reference pages `docs/cli/add.mdx`, `docs/cli/install.mdx`, and `docs/cli/remove.mdx` MUST document repeatable exclusive targets, full non-target purge behavior, validation, and examples.

The specification documentation `docs/specification/commit.mdx`, `install.mdx`, `materialization.mdx`, `terminology.mdx`, `manifest.mdx`, and `index.mdx` MUST define target and purge sets while retaining adapter-agnostic receipt ownership. `docs/specification/lockfile.mdx` and `project-manifest.mdx` MUST clarify that neither artifact stores adapter targets.

The guides `docs/guides/install-facets.mdx`, `troubleshooting.mdx`, and `custom-adapters.mdx` MUST explain exclusive placement, rematerialization through later unfiltered installs, and failure when a purge adapter cannot be loaded. Root `README.md`, navigation, authoring docs, and adapter SDK reference were reviewed and do not require changes.

## Risks / Trade-offs

- **[Users interpret `--adapter` as “leave others untouched”]** → Help, progress, and summaries MUST call the list exclusive and explicitly name purge adapters. The absence of this flag retains current non-destructive behavior.
- **[A non-target adapter is broken or unavailable]** → The operation MUST fail before mutation because it cannot guarantee the exclusive postcondition.
- **[An adapter is no longer installed and therefore cannot be discovered]** → The operation cannot purge it. Adapter-agnostic receipt authority is retained so a later operation can manage identities if the adapter returns.
- **[The purge touches many files for a small add or remove]** → This cost is accepted to preserve one simple placement invariant. Plans remain no-op aware, and all changes share one transaction.
- **[Purge and target adapters share native configuration documents]** → Their transitions MUST compose in deterministic purge-then-target order or fail before commit.
- **[The receipt claims identities in adapters where they are absent]** → This is the existing adapter-agnostic ownership model. Adapter removal plans tolerate absence, and later target reconciliation may rematerialize the identity.
- **[Unknown-flag permissiveness causes an unfiltered run]** → The three installation commands SHALL reject undeclared flags before adapter selection.

## Migration Plan

1. Keep receipt schema `0.4` and existing loaders/writers unchanged.
2. Add repeatable CLI target parsing and resolve `all` or `exclusive` target requests at the shared adapter-selection boundary.
3. Add full-project purge planning for non-target assets and MCP entries, then compose purge and target transitions in the existing transaction.
4. Update scope reporting, documentation, and tests in the same release. Tests MUST cover single and multiple targets, duplicate names, unavailable purge adapters, complete non-target asset and MCP removal, add/install/remove semantics, shared native documents, rollback, frozen mode, unfiltered rematerialization, and unchanged receipt bytes/schema.
5. Rollback requires no artifact migration; removing the new CLI option and purge orchestration restores prior behavior.

## Open Questions

None. The design settles exclusive target semantics, receipt ownership, transaction ordering, MCP behavior, frozen mode, and the extension point for future project defaults.
