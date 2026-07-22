## Why

A facet install crashed against a stale installed adapter bundle with an opaque `paths[0]` error: the engine and the bundle disagreed about the adapter call contract, and nothing in the system could detect the disagreement before invoking a method. Adapter bundles cross a publishing and persistence boundary — npm, git, local paths, files on disk that outlive CLI upgrades — yet the contract they implement is invisible: no version is declared, selected against, or verified anywhere. With a breaking contract revision already staged, this boundary MUST become versioned before any incompatible release exists.

## What Changes

- **Adapter API `0.0`.** The current positional adapter contract SHALL be designated adapter API `0.0`. Adapter API identifiers SHALL be discrete tokens compared for exact equality — not semver ranges — and SHALL be independent of the SDK package's npm version, the CLI version, and adapter package versions.
- **The SDK declares the version, not the author.** `defineAdapter()` SHALL stamp the SDK's canonical API version (`0.0`) onto every adapter it returns. Adapter authors SHALL NOT hand-write the version; rebuilding against a newer SDK is what changes it.
- **The CLI declares its support set.** This CLI release SHALL support exactly `{0.0}`. A bundle whose runtime declaration is missing, malformed, or outside the support set SHALL be rejected with structured data before any adapter method is invoked — in facet install, build, and every other consumer, regardless of how the bundle reached disk (npm, git, local path, manual copy, or a bundle left behind by an older CLI).
- **npm releases advertise their API.** New adapter releases SHALL declare their adapter API version in npm package metadata so compatibility is knowable before download. First-party adapters SHALL publish releases declaring `0.0`. The loaded bundle's runtime declaration remains authoritative; a mismatch between package metadata and the runtime export SHALL fail verification.
- **Compatibility-aware resolution.** `facet adapter install` SHALL stop resolving the npm `latest` dist-tag and SHALL select the highest package version whose declared API the CLI supports. When the user pins an exact package version or range, the CLI SHALL honor it and fail on incompatibility — never silently substitute. When no published release is compatible, resolution SHALL fail with a structured error naming the newest release's declared API and the CLI's support set.
- **`latest` stays normal.** Publishing SHALL keep advancing npm `latest` normally; compatibility is the CLI's responsibility, not a dist-tag policy.
- **Staged atomic replacement.** A candidate bundle SHALL be verified before it replaces an installed bundle, and replacement SHALL be atomic: a failed install leaves the existing working bundle untouched.
- **Provenance.** Installation SHALL record, beside the bundle: the install specifier, resolved source, resolved package name/version when known, adapter API version, and bundle integrity — the anchor for offering a compatible reinstall or upgrade later.
- **Actionable diagnostics.** Incompatibility failures SHALL name the adapter, the API found (or that none was declared), the supported set, and the exact reinstall command. Facet installation with an incompatible selected adapter SHALL fail before any materialization writes. `facet adapter list` SHOULD surface each installed adapter's API version and compatibility.
- **BREAKING.** Existing unversioned bundles — everything installed today and every already-published adapter release — SHALL be incompatible with this CLI and SHALL require reinstalling a `0.0`-declaring release. This is deliberate: the project is forward-only, and a one-time reinstall is cheaper than carrying a permanent undeclared-legacy compatibility class.

Documentation (Article III): `docs/cli/adapters/install.mdx`, `docs/guides/custom-adapters.mdx`, `docs/guides/troubleshooting.mdx`, and `docs/specification/install.mdx` informed this proposal; none currently document API declarations, compatibility-aware selection, or the pre-materialization gate, and all four SHALL be updated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `adapter__sdk`: the positional contract becomes adapter API `0.0`; the factory SHALL stamp the canonical API version onto every runtime adapter it returns.
- `adapter__management`: install resolution SHALL select the highest compatible release; verification SHALL check the API declaration; replacement SHALL be staged and atomic; provenance SHALL be recorded; loading SHALL reject unsupported bundles with structured failures; listing SHOULD surface compatibility.
- `installation`: facet installation SHALL fail with a structured incompatible-adapter diagnostic before any materialization writes occur.

## Impact

- `packages/adapter/`: canonical API version constant, `apiVersion` on the runtime adapter type, stamping in `defineAdapter()`.
- `packages/adapters/*`: new first-party releases published with metadata and runtime declarations.
- `packages/engine/src/sources/adapter/`: full-metadata npm resolution replacing `/latest`.
- `packages/engine/src/adapters/`: verification, placement (staged atomic replacement, provenance record), loader rejection, install-service failure types.
- CLI: adapter install/list output; facet-install and build failure rendering.
- Users: a one-time reinstall of currently installed adapters.

## Non-goals

- This change SHALL NOT alter the positional method signatures designated `0.0` and SHALL NOT introduce any later adapter API contract.
- This change SHALL NOT manipulate npm dist-tags and SHALL NOT attempt retroactive protection of already-shipped CLIs.
- This change SHALL NOT store multiple adapter versions side by side.
- This change SHALL NOT automatically upgrade an incompatible installed adapter; the failure directs the user to the fix.
- This change SHALL NOT couple adapter API identifiers to facet archive versions, facet package versions, or the SDK package's own semver.
