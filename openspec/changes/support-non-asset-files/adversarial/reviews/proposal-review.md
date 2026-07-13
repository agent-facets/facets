# Proposal comparison: `support-non-asset-files`

This review compares **Main** at `proposal.md` with **Adversary** at `adversarial/artifacts/proposal.md`.

## Grading bar

I graded the proposals for customer/developer value, correct RFC 2119 usage, atomic and testable scope, valid OpenSpec proposal mechanics, complete product-domain coverage, documentation alignment, and explicit treatment of compatibility and security boundaries.

## Coverage comparison

Both versions cover the same core value: authors can ship declared non-asset files; all shipped bytes remain integrity-protected; skill companion files install with the skill; files elsewhere remain archive-only; and existing product domains rather than a new capability own the behavior. Both identify the six affected domains: `authoring__facets`, `protocol__schemas`, `protocol__content-hashing`, `protocol__integrity`, `installation`, and `adapter__assets`.

Main is stronger on current-system diagnosis, adapter lifecycle impact, concrete code impact, the registry as a second implementation, and the existing semantic-versioning authority. Adversary is stronger on explicit archive-membership validation, preserving the asset/non-asset distinction, compatibility severity, non-goals, security-test scope, and documentation breadth.

The material divergences are: whether skill companion files are explicitly declared or implicitly discovered; whether non-asset hashes belong in a field named `assets`; whether this is merely a forward-compatibility note or an explicit protocol compatibility boundary; how multi-file skill ownership/deletion is represented; and whether required non-goals and affected installation/authoring documentation are in scope.

## Section-by-section findings and merge recommendations

### Why

**Main is stronger.** It explains the end-to-end failure mode precisely: build drops unsupported files and verification rejects extra archive entries under outer exclusivity. It also distinguishes human-facing root files from Agent Skills companion resources, making the developer value concrete.

**Merge recommendation:** keep Main's `Why`, while retaining Adversary's concise statement that supporting files are not independently installable assets. That distinction should frame the whole change.

### What Changes — declaration and archive membership

**Adversary is stronger.** Main says the manifest declares non-asset files, but separately says every file under `skills/<name>/` SHALL ship. That leaves a material ambiguity: are skill descendants individually declared, declared by a directory/glob, or automatically discovered? Automatic discovery conflicts with Adversary's stronger and safer rule that archive membership remains explicit and reviewable. Adversary also names missing, undeclared, duplicate/colliding, and unsafe paths as validation failures; Main names undeclared files and later mentions missing files, but does not establish the complete validation boundary.

**Merge recommendation:** state one source of truth for membership: every supplementary archive entry, including every skill companion file, MUST be derivable from an explicit manifest declaration. Defer the declaration syntax to design, but require missing files, undeclared entries, path traversal/unsafe paths, and collisions or duplicate resolved paths to fail validation. Do not imply recursive auto-discovery unless that is an intentional product decision.

### What Changes — integrity and schema semantics

**Main is stronger on the observable guarantee** because it explicitly requires per-entry hashes plus inclusion in the bytes covered by content integrity. **Adversary is stronger on type semantics** because it requires schemas to represent the complete tracked file set without classifying supplementary files as assets. Main's statement that the build manifest's `assets` map will cover non-asset entries contradicts the proposal's own asset/non-asset distinction and prematurely fixes a design choice.

**Merge recommendation:** keep Main's two-layer integrity guarantee and expanded outer-exclusivity derivation set. Replace the `assets`-map commitment with a requirement that the build manifest represent and hash every tracked entry while preserving an unambiguous distinction between installable assets and supplementary files; settle the exact schema shape in design.

### What Changes — installation and adapter lifecycle

**Main is stronger.** It identifies install, read, and delete behavior, third-party adapter breakage, and drift removal for multi-file skills. Adversary adds an important boundary: supplementary files do not gain independent install scope, adapter metadata, or lockfile asset tuples.

**Merge recommendation:** combine these. Require skill companion files to be installed and removed atomically with their owning skill through the adapter contract, with receipt/ownership data sufficient for drift removal. Explicitly prohibit supplementary files from becoming independently addressable assets. Leave the exact adapter payload and receipt schema to design.

### What Changes — compatibility

**Adversary is stronger.** Main accurately notes that old consumers reject the new archives and cites `openspec/specs/protocol/spec.md`, but labels this only a forward-compatibility note. That is insufficient when the existing protocol says backward-incompatible changes require a new major version. Adversary correctly marks the archive-entry expansion as breaking and requires an explicit compatibility boundary while preserving legacy asset-only validity.

**Merge recommendation:** mark the protocol/archive change as **BREAKING**, require the design to choose an explicit protocol or archive-version boundary, and require compatibility tests proving that legacy asset-only artifacts remain valid. Keep Main's explicit note that other implementations, including the cafe registry, must adopt the new verification contract before accepting new-format archives.

### Capabilities

Both versions select valid existing product domains and avoid inventing a feature-domain. Main is stronger on installation receipt behavior; Adversary is stronger on schema semantics and path-safety coverage.

**Merge recommendation:** retain all six domains, but revise `protocol__schemas` so it does not assert that non-assets belong in an `assets` map. Carry explicit membership/path validation under `authoring__facets`, complete-entry hashing under `protocol__content-hashing`, complete-entry reconciliation under `protocol__integrity`, atomic multi-file skill lifecycle under `installation`, and the corresponding consumer contract under `adapter__assets`.

### Non-goals

**Adversary is decisively stronger. Main has no `## Non-goals` section, violating the mandatory proposal rule in `openspec/config.yaml`.** Adversary correctly excludes README display/`facet info`, arbitrary independent installation destinations, command/agent directory-install semantics, filesystem metadata such as symlinks and executable bits, and automatic packaging of untracked files.

**Merge recommendation:** add a `## Non-goals` section containing those five boundaries. This is required before the proposal is conforming.

### Impact and documentation

**Main is stronger on code and ecosystem impact:** it names affected modules, third-party adapters, error rendering, and the cafe registry. **Adversary is stronger on verification and documentation completeness:** it calls for traversal, collision, undeclared-entry, and tamper tests and cites the authoring/install guides plus root `README.md`, not only protocol reference pages. Since authoring and installation behavior change, those guides are materially affected.

**Merge recommendation:** retain Main's code and registry impact, add Adversary's security/compatibility test matrix, and explicitly scope review or updates for `docs/guides/create-your-first-facet.mdx`, `docs/guides/install-facets.mdx`, and root `README.md` alongside the four protocol pages. Keep Main's conditional review of `docs/specification/lockfile.mdx`, but make it unconditional if receipt or lockfile semantics change.

## Blocking cross-cutting items

1. **Proposal mechanics:** Main MUST gain the required `Non-goals` section before it can be accepted.
2. **Membership source of truth:** the change MUST settle whether skill companion files are explicitly declared or implicitly discovered; later specs cannot be atomic or testable while both readings remain possible.
3. **Protocol compatibility:** the artifact MUST acknowledge the change as backward-incompatible and establish that design will choose an explicit major/version boundary rather than relying on a forward-compatibility note.
4. **Asset identity and ownership:** supplementary-file hash records and multi-file skill receipts MUST preserve the distinction between assets and non-assets and define ownership sufficient for safe deletion without creating independent supplementary-file asset tuples.
