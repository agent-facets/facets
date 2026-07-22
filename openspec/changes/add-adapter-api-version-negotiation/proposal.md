## Why

The CLI currently downloads an npm adapter's `latest` release and loads installed bundles as the current TypeScript `Adapter` type without checking whether their runtime call contract is compatible. The adapter contract itself has no machine-readable version, so neither package resolution nor runtime loading can distinguish a compatible bundle from one built for a different call shape. The project is forward-only and cannot make already-published CLIs compatibility-aware, so this change establishes a complete versioned boundary now instead of assigning permanent compatibility semantics to an undeclared legacy state.

## What Changes

- Designate the current positional adapter method contract as adapter API `0.0`. Adapter API versions SHALL be discrete contract identifiers compared for exact equality, SHALL NOT be interpreted as semantic-version ranges, and SHALL be independent of CLI, adapter-package, and Adapter SDK package versions.
- Version the Adapter SDK boundary. The SDK SHALL expose `0.0` as its canonical API version, and `defineAdapter()` SHALL stamp that version onto every returned runtime adapter without requiring adapter authors to repeat it in their definitions.
- Make compatibility explicit on both sides. This CLI SHALL support exactly adapter API `0.0`; an adapter with a missing, malformed, or different API declaration SHALL be incompatible rather than treated as a legacy-compatible bundle.
- Require npm adapter releases to expose their adapter API version in package metadata so compatibility can be determined before download. New first-party adapter releases SHALL declare API `0.0` in package metadata and through their SDK-produced runtime exports.
- Replace npm `/latest` resolution with selection from package-version metadata. A plain npm or first-party install SHALL choose the highest package version whose declared adapter API is supported by the CLI. An explicit package range SHALL constrain compatible selection, while an explicit exact package version SHALL fail when that release is incompatible rather than silently substituting another release. When no package version in the requested set declares a supported adapter API, resolution SHALL fail with structured data identifying the newest considered release, its declared or missing adapter API, and the CLI's supported APIs.
- Preserve normal npm publishing semantics: the npm `latest` tag SHALL continue to identify the latest published adapter release. Compatibility selection SHALL be the CLI's responsibility and SHALL NOT depend on moving, pinning, or withholding that tag.
- Verify API compatibility before placing a downloaded bundle and before returning an installed bundle to build or installation workflows. A bundle with a missing, malformed, or unsupported adapter API SHALL fail with structured data before any adapter method is invoked.
- Treat npm metadata as a selection aid and the loaded bundle's runtime declaration as the final compatibility check. Missing runtime declarations and conflicts between package metadata and the runtime export SHALL fail verification rather than silently selecting a call shape.
- Stage and verify a candidate bundle before replacing an installed bundle. Replacement SHALL be atomic, and any verification or placement failure SHALL leave the existing installed bundle unchanged.
- Retain installation provenance needed to identify and replace an incompatible adapter: source specifier, resolved npm package/version when applicable, adapter API version, and package integrity.
- Return actionable diagnostics that identify the adapter, its declared or missing API, the APIs supported by the CLI, and the compatible-install command. When a selected installed adapter is incompatible, facet installation SHALL fail before any materialization writes. `facet adapter list` SHALL surface each installed adapter's declared or missing adapter API and whether it is supported by the current CLI.
- Update `docs/cli/adapters/install.mdx`, `docs/guides/custom-adapters.mdx`, `docs/guides/troubleshooting.mdx`, and `docs/specification/install.mdx`, which do not yet document compatibility-aware adapter selection, incompatible-adapter diagnostics, or the compatibility gate before materialization.

- **BREAKING:** This change does not alter the positional method signatures assigned to API `0.0`, but undeclared adapters SHALL become incompatible. Existing installed bundles SHALL require replacement with a version-declaring release, and existing unversioned npm releases SHALL not be compatible candidates for this CLI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `adapter__sdk`: the current positional adapter contract SHALL become API `0.0`, and the SDK factory SHALL stamp the canonical API version onto every runtime adapter.
- `adapter__management`: npm installs SHALL select the highest CLI-compatible adapter package; installed bundles SHALL be compatibility-checked before use; verified replacements SHALL be atomic; installation provenance and incompatibility failures SHALL be available to the user-facing workflow; and adapter listing SHALL surface each installed adapter's API compatibility.
- `installation`: facet installation SHALL reject an unsupported selected adapter with structured, actionable diagnostics before any materialization writes occur.

## Impact

- The Adapter SDK under `packages/adapter/` will define the canonical API `0.0` identifier, include it in the runtime adapter type, and stamp it from `defineAdapter()`.
- First-party adapter packages under `packages/adapters/` will publish new releases declaring API `0.0` in npm metadata and runtime exports.
- Adapter source parsing and npm package resolution under `packages/engine/src/sources/adapter/` will become package-version- and adapter-API-aware instead of requesting only `/latest`.
- Adapter verification, placement, loading, and installation services under `packages/engine/src/adapters/` will classify compatibility, retain installation provenance, and atomically replace only verified bundles.
- Facet installation orchestration and CLI adapter-install, facet-install, adapter-list, and runtime-loading output will reject or surface incompatible selected adapters before materialization and expose structured compatibility information and diagnostics.
- npm registry metadata becomes an input to compatible version selection; Git and local adapters cannot be version-selected and MUST pass runtime compatibility verification as supplied.
- Existing unversioned installed bundles and npm releases will require replacement with newly versioned adapter releases.
- Adapter installation and authoring documentation will explain API declarations, compatible resolution, migration from undeclared bundles, and pre-materialization failure behavior.

## Non-goals

- This change SHALL NOT alter the positional adapter method signatures designated as API `0.0` or introduce any later adapter API contract.
- This change SHALL NOT alter, pin, or delay npm's `latest` dist-tag and SHALL NOT attempt to protect CLI releases that predate compatibility-aware resolution.
- This change SHALL NOT install or retain multiple adapter versions side by side.
- This change SHALL NOT automatically upgrade an incompatible installed adapter during `facet install`; it SHALL fail before materialization and direct the user to install a compatible release.
- This change SHALL NOT couple adapter API compatibility to facet archive versions, facet package versions, or the Adapter SDK package's own semantic version.
