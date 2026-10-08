## Why

Downstream exporters and consumers that verify their output cannot use committed project files to reconstruct the selected MCP server set or recover every contributing facet's provenance after aliases, omissions, and deduplication. A fingerprint-only lockfile inventory closes that gap without exposing declaration values and also lets frozen installation detect server-intent drift before fetching facet content.

## What Changes

- **BREAKING: lockfile `0.4` records server inventory.** Every facet entry SHALL contain a `servers` list, including when empty, sorted by authored name. Each record SHALL contain its authored name, canonical declaration fingerprint, and authored, aliased, or omitted materialization disposition. The enclosing facet entry SHALL supply facet identity, source, version, and facet integrity. Server-only facets SHALL remain valid with empty text-asset inventories. Records SHALL NOT contain commands, URLs, arguments, or environment data. Lockfiles `0.2` and `0.3` SHALL remain readable.
- **Bind the fingerprint encoding.** Recorded fingerprints SHALL use the existing canonical portable-declaration encoding `facets:mcp-server:v1`, not native configuration bytes. Lockfile `0.4` SHALL bind to that encoding; a future encoding revision SHALL require a new lockfile schema rather than silently reinterpreting stored fingerprints. Existing normalization and name-independence SHALL remain unchanged.
- **Expose the effective inventory publicly.** The published protocol API SHALL derive the selected inventory from locked records without cache, archive, network, or server access, preserving every origin's facet identity, source, version, facet integrity, and authored server name. It SHALL follow the existing materialization rules and agree with declaration-based planning. Identical declarations at one effective identity SHALL retain every claimant; conflicts SHALL NOT select a winner. Omitted records SHALL remain in authored inventory but SHALL NOT contribute to the selected set. Older formats SHALL report unavailable inventory, never an empty inventory.
- **Derive and reconcile records from verified content.** Newly derived inventory SHALL come only from verified facet definitions, not adapters, receipts, or native configuration. Reproducing the same facet integrity SHALL reconcile the complete authored server set and fingerprints, including omitted servers, against verified content before cleanup or materialization. Missing, unexpected, or mismatched records SHALL fail rather than be silently repaired. Hash-only inventory SHALL NOT replace the declarations needed to render native configuration.
- **BREAKING: make frozen server-intent checks explicit.** With `0.4`, frozen installation SHALL detect server collisions, stale overrides, and disposition drift against `facets.json` from locked records before fetching content and without rewriting shared state. Subsequent content verification and native-configuration checks SHALL remain required. With `0.2` or `0.3`, a server override SHALL cause a pre-fetch format-capability failure with guidance to run a normal install. Without server overrides, existing content-derived frozen reproduction SHALL remain available, subject to existing asset and integrity gates. Frozen mode SHALL NOT migrate either shared file.
- **Migrate without inventing completeness.** Successful non-frozen installation SHALL write `0.4`, populating inventory from verified definitions and preserving supported extension data. Removal-only operations SHALL preserve complete remaining inventories when existing refinement conditions hold. If any remaining facet lacks server inventory, removal SHALL fall back to ordinary resolution rather than write an older schema or manufacture records. This migration may require network access when verified content is unavailable locally; inability to obtain it SHALL fail without committing project changes and with actionable guidance. Removing all remaining facets SHALL NOT require inventing inventory for removed facets.

## Capabilities

### New Capabilities

None. This change extends existing artifact and installation contracts.

### Modified Capabilities

- `protocol__schemas`: Publish the `0.4` fingerprint-only server inventory, its fixed encoding binding, and public effective-inventory derivation under existing planning rules.
- `installation`: Generate, reconcile, migrate, and preserve complete inventories; extend frozen checks to recorded server intent, define legacy behavior, and require verified migration when removal cannot refine remaining state completely.

## Impact

Affected packages are `@agent-facets/protocol`, the installation engine, and CLI diagnostics under existing drift-reporting requirements. Existing Adapter SDK API `0.3` requests remain unchanged: downstream exporters already receive effective names and portable declarations. Teams sharing a `0.4` lockfile require a CLI that recognizes it. Archive and project-manifest formats do not change.

Consumers can verify exported portable declarations by combining public inventory derivation with the existing canonical fingerprint function and comparing complete effective-name/fingerprint sets. A documented example and public-consumer tests SHALL demonstrate this workflow; a dedicated comparison API is not required.

Documentation changes SHALL cover:
- `docs/specification/lockfile.mdx`: examples, Fields, Entry fields, Unrecognized fields, and “Why MCP did not move the lockfile.”
- `docs/specification/materialization.mdx`: Dispositions, particularly the claim that omitted servers leave no lockfile trace.
- `docs/specification/install.mdx`: Frozen lockfile, distinguishing pre-fetch inventory/intent checks from content verification.
- `docs/cli/install.mdx`: Frozen lockfile and migration troubleshooting.

The canonical fingerprint section in `docs/specification/manifest.mdx`, stale-override behavior in `docs/cli/add.mdx`, and `docs/reference/adapter-sdk.mdx` inform contracts that remain unchanged.

Tests SHALL cover server-only and empty inventories; aliases and omissions; identical, conflicting, and distinct-identity declarations; every origin; canonical stability and value changes; tampered, missing, and unexpected records; deterministic ordering; verified migration from `0.2` and `0.3`; extension preservation; legacy-removal fallback and complete-inventory refinement; and frozen failures without mutation. Locked-record planning SHALL be tested for equivalence with declaration planning. Tests SHALL cover pre-fetch `0.4` drift failures, legacy frozen refusal with server overrides, and legacy reproduction without them. Public-consumer tests SHALL verify exports without cache, archive, or network access; consent, takeover, and ownership regression tests SHALL remain.

## Non-goals

- Persisting declaration bodies, native configuration, per-adapter hashes, or approval evidence in the lockfile.
- Changing consent, `--accept-mcp`, takeover approval, or receipt-based deletion authority. A locked fingerprint SHALL NOT confer approval or ownership.
- Expanding adapter requests, bumping the Adapter SDK API, adding an inventory CLI command, or adding a dedicated export-comparison API.
- Reconstructing declarations from hashes or changing archive integrity or fingerprint semantics. Comparing recomputed export fingerprints establishes agreement with a trusted lockfile, not lockfile authenticity, archive membership, or successful native installation; merely echoing expected fingerprints proves no value comparison.
- Launching, probing, authenticating to, or connecting to MCP servers. Offline provenance verification does not make missing facet content available to cold-cache frozen installation.
