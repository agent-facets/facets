## Why

The registry now models ownership with scoped facet names (`@scope/name`) instead of collections, but the CLI authoring and publishing path still needs a full audit so authors can create, build, and publish those names without client-side rejection or stale collection terminology. This change aligns the local facet workflow with the registry API so a user or future organization scope can own published facets without the CLI needing to understand organization semantics.

## What Changes

- Allow facet identity names to use either unscoped kebab-case form (`name`) or scoped form (`@scope/name`) consistently wherever facet manifests are created, validated, built, installed by source specifier, discovered in `dist/`, drift-checked, and uploaded.
- Update `facet create` and `facet edit` identity validation and guidance so authors MAY enter scoped names while asset names remain kebab-case and path-safe.
- Ensure `facet add` and source-specifier parsing accept registry sources like `@scope/name`, `@scope/name@1.2.3`, and `@scope/name@latest`, disambiguating the leading scope marker from the trailing version separator.
- Ensure build output naming, publish artifact discovery, source/artifact identity drift detection, and registry upload addressing handle scoped names without confusing the scope separator (`/`) with a filesystem path. In particular, build output writing MUST create any needed parent directories for names that render as nested paths under `dist/`; this fixes the scoped-name break and the pre-existing failure for any slash-containing identity.
- Audit code, tests, CLI text, docs, and existing specs for the removed “collection” concept and replace customer-facing terminology with “scope” where it refers to registry ownership, including governance examples that still use collection-oriented capability names.
- Keep the CLI scope-agnostic: it SHALL pass scoped names through to the registry and surface registry decisions verbatim rather than deciding whether a scope is a user, organization, or otherwise authorized owner.
- Documentation informed this proposal: `docs/specification/manifest.md` already documents scoped names in composed facet references; `docs/cli/authoring/create.md`, `docs/cli/authoring/build.md`, `docs/cli/authoring/publish.md`, and `docs/guides/publish-a-facet.md` document the affected authoring/build/publish flow and will need alignment where examples or constraints still imply unscoped kebab-case-only names.

## Non-goals

- This change SHALL NOT add organization management, organization membership, or scope-claiming flows to the CLI.
- This change SHALL NOT re-run registry OpenAPI synchronization; the local generated registry types and checked-in OpenAPI snapshot are the inputs for implementation.
- This change SHALL NOT reintroduce collections as a compatibility alias in user-facing CLI behavior.
- This change SHALL NOT change asset naming rules; skills, agents, and commands SHALL remain independently validated as kebab-case local asset identifiers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `protocol__schemas`: facet manifest identity validation is changing to specify the accepted scoped facet name grammar in the normative schema.
- `authoring__facets`: authoring requirements are changing so scaffold, edit, build, and validation workflows accept scoped facet identities while preserving kebab-case asset names.
- `installation`: registry source specifier parsing and add/install requirements are changing so scoped registry facet names are accepted and version suffixes are parsed unambiguously.
- `publishing`: publish requirements are changing so verified scoped artifact identities are used correctly for artifact lookup, drift handling, and registry upload addressing.
- `spec-governance`: governance examples are changing to remove collection-oriented capability names from normative examples.

## Impact

- Affected packages likely include `packages/common` name validation helpers, `packages/protocol` facet/build manifest schemas and validators, `packages/engine` source parsing, scaffold/build/publish paths, and `packages/cli` add/create/edit/publish presentation and tests. Registry client URL encoding should be verified against the generated local types and existing tests before changing it.
- Registry-facing implementation will rely on the already-synced local OpenAPI snapshot and generated types under the engine registry code; the sync process SHALL NOT be run again for this change.
- Docs and examples in `docs/specification/manifest.md`, `docs/cli/authoring/create.md`, `docs/cli/authoring/build.md`, `docs/cli/authoring/publish.md`, and `docs/guides/publish-a-facet.md` may need updates so constraints and output examples reflect scoped facet names and no longer mention collections.
