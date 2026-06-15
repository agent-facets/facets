## Context

The registry now identifies ownership with scoped facet names such as `@julian/cowsay`, replacing the older collections language. The local CLI stack currently has partial support for slash-containing names but not for leading-`@` scoped names: `facet add` rejects them in `parseFacetSource`, `facet create`/`facet edit` validate the facet identity as kebab-case, and build/cache output paths can treat the slash in a facet name as a directory without creating the required parent directories. The storage-path defect predates scoped names for any slash-containing identity such as `acme/cowsay`; scoped support makes that latent bug unavoidable. The registry API accepts scoped facets through route structure with a literal `@scope` path segment followed by the facet name segment, so registry client plumbing must use that generated API shape rather than encoding the whole scoped identity into one path parameter.

The change crosses protocol, engine, CLI, tests, and docs. The registry OpenAPI snapshot and generated types have already been synced and SHALL NOT be regenerated as part of this change.

User-facing documentation that needs alignment: `docs/specification/manifest.md`, `docs/cli/authoring/create.md`, `docs/cli/authoring/build.md`, `docs/cli/authoring/publish.md`, `docs/cli/add.md`, `docs/guides/install-facets.md`, `docs/guides/create-your-first-facet.md`, and `docs/guides/publish-a-facet.md`. Normative spec-governance examples in `openspec/specs/spec-governance/spec.md` also contain collection-oriented capability names and SHOULD be updated by the specs/implementation work.

## Goals / Non-Goals

**Goals:**

- Define one authoritative facet identity grammar: unscoped `name` and scoped `@scope/name`, with both `scope` and `name` using the same lowercase kebab segment grammar.
- Reuse that grammar in protocol manifest validation, engine registry source parsing, and CLI authoring validation.
- Parse `@scope/name@version` by treating only the final `@` after the slash as the version separator; the leading `@` is part of the scope marker.
- Ensure build output and cache paths create required parent directories for scoped names.
- Keep registry operations scope-agnostic: the CLI SHALL send the scoped name and render registry authorization or ownership failures verbatim.
- Remove or replace user-facing “collection” terminology where it refers to registry ownership.

**Non-Goals:**

- Organization management, scope claiming, membership checks, and authorization policy are registry concerns and SHALL NOT be implemented in the CLI.
- The CLI SHALL NOT provide a collection compatibility alias.
- Asset names SHALL remain local kebab-case identifiers; scoped facet identity support SHALL NOT make skill, agent, or command names slash- or at-sign-qualified.
- Registry OpenAPI sync SHALL NOT be rerun.
- Cross-scope ownership transfer semantics are out of scope. Editing a facet identity to a different scope MAY be allowed as a local manifest edit, but whether the resulting scoped artifact can be published SHALL remain a registry authorization decision.

## Decisions

### 1. Put facet identity grammar in protocol and re-export for CLI use through engine

Add a protocol-level pure validator/parser for facet identity names, for example `parseFacetName(value): FacetNameResult` or `validateFacetName(value): ValidatedFacetNameResult`, using a discriminated union result rather than thrown errors. The grammar SHALL accept:

- `name`
- `@scope/name`

where each segment starts with a lowercase letter and then contains lowercase letters, digits, or hyphens. It SHALL reject empty scope/name segments, backslashes, `.`/`..` segments, uppercase letters, spaces, missing slash after `@scope`, and extra path depth. `FacetManifestSchema` SHALL use this validator for the manifest `name` field. Engine SHALL import this grammar for registry source parsing and scaffold/edit validation; CLI SHALL consume it via engine exports alongside the existing asset-name helpers.

Malformed facet manifest names SHALL be hard validation errors, not warning-only diagnostics. This intentionally tightens the previous `name: string` behavior so invalid local identities fail at manifest validation instead of deferring failure until build, publish, or install.

Alternative considered: extend `validateAssetName` to cover facet names. Rejected because asset names and facet identities now intentionally diverge: assets remain local path-safe kebab identifiers, while facet identities may be registry-scoped. Combining them would make illegal states easier to represent and would risk accidentally allowing scoped asset names.

### 2. Parse registry source specifiers with an explicit scoped-name split

Replace the current `REGISTRY_RE`-only parse with a small parser that first recognizes registry-name grammar, then splits an optional version suffix. For unscoped names, `name@version` keeps the existing behavior. For scoped names, the parser SHALL require `@scope/name` first, then MAY split a version at the next `@` after the slash. Examples:

- `cowsay` → name `cowsay`, version `latest`
- `cowsay@1.2.3` → name `cowsay`, version `1.2.3`
- `@julian/cowsay` → name `@julian/cowsay`, version `latest`
- `@julian/cowsay@latest` → name `@julian/cowsay`, version `latest`

Invalid forms such as `@julian`, `@julian/`, `@julian/cowsay@`, and `@julian/cowsay@^1.0.0` SHALL return typed parse failures. The parser SHALL preserve existing priority for paths, GitHub shorthand, SCP-style git, and URL sources before registry parsing.

Alternative considered: one larger regex. Rejected because the scope marker and version separator both use `@`; explicit split logic is easier to test and makes the ambiguity visible.

### 3. Treat slash-containing facet identities as nested storage paths only at storage boundaries

The canonical facet name remains the exact manifest/registry identity string (`@scope/name`). Storage helpers that derive paths from names SHALL create parent directories before writing or renaming. At minimum:

- `writeBuildOutput` SHALL create `dirname(join(distDir, archiveFilename))` before writing the `.facet` archive.
- Cache put logic SHALL create `dirname(cachePath(identity))` before renaming a staging directory into a slot for a slash-containing registry/git/local identity.
- Existing recursive publish discovery under `dist/` SHALL remain because it already finds nested `.facet` archives and supports identity drift detection.

Alternative considered: percent-encode or otherwise flatten names on disk. Rejected for this change because the existing `buildArtifactFilename` contract and publish discovery already document namespaced paths; creating parents is the smallest compatible fix. A future storage-layout change can be proposed separately if flat paths become preferable.

Tests SHALL cover both scoped names (`@scope/name`) and slash-containing unscoped names (`scope/name`) for the build and cache write boundaries so this fix is verified as both scoped-name enablement and repair of the pre-existing nested-path bug.

### 4. Use the registry's scoped route shape without percent-encoding the scope marker

Registry metadata, archive lookup, and publish code SHALL use the scoped route shape exposed by the generated OpenAPI types. Scoped names SHALL be split into the API's scope and facet-name path components where the API requires that shape, preserving the literal `@` scope marker as its own path segment. The client SHALL NOT percent-encode a scoped identity into a single `{name}` path parameter such as `%40scope%2Fname`.

Implementation SHALL add or update tests for `@scope/name` metadata resolution, archive URL lookup, and publish path construction. Those tests SHALL assert that scoped registry requests use the direct scoped path form the registry accepts, with an unencoded `@` marker and separate scope/name path segments.

Alternative considered: manually call `encodeFacetName` or rely on generated-client path-parameter encoding for the entire scoped identity. Rejected because the registry API models scope and facet name as path structure, not as one encoded path parameter.

### 5. Documentation and terminology updates are part of the implementation

Docs that describe facet-name constraints SHALL show both unscoped and scoped examples. Create/edit docs SHALL distinguish facet identity names from asset names. Build/publish docs SHALL show scoped output paths where relevant. Install/add docs SHALL document `@scope/name` and `@scope/name@version` source specifiers. Collection terminology SHALL be removed where it names the old registry ownership model, while ordinary English uses of “collection” unrelated to registry ownership MAY remain.

`facet edit` SHALL NOT warn specially when an author changes an existing facet identity from one scope to another. Cross-scope movement is a normal local manifest edit; source/artifact identity drift and registry authorization are the appropriate downstream checks.

Alternative considered: leave docs to a later release. Rejected because current docs explicitly say `facet create` uses kebab-case names and would contradict the shipped behavior.

## Risks / Trade-offs

- **Risk: scope `@` is misparsed as a version separator.** → Mitigation: implement scoped parsing with slash-aware split logic and table-driven tests for bare, latest, exact, wildcard, and invalid scoped inputs.
- **Risk: filesystem path traversal through scoped names.** → Mitigation: constrain the facet-name grammar to two safe kebab segments, reject `.`/`..` and backslashes, and only derive paths through existing `join` helpers after validation.
- **Risk: manifest schema tightening rejects previously loadable local manifests.** → Mitigation: make the accepted grammar explicit in specs/docs, add clear validation errors, and treat this as an intentional registry-alignment tightening rather than a warning-only lint. The implementation SHOULD include tests for invalid legacy-ish names that used to pass because `name` was only typed as `string`.
- **Risk: cache layout changes for slash-containing names expose existing ENOENT bugs.** → Mitigation: create parent directories at cache/build write boundaries and add tests for scoped registry cache slots and scoped build output.
- **Risk: registry client code encodes scoped names into the wrong route shape.** → Mitigation: use the generated OpenAPI route shape for scoped facets, preserve the literal `@scope` path segment, and add tests that assert scoped metadata, archive, and publish requests use separate scope/name path segments rather than `%40scope%2Fname`.
- **Risk: collection terminology audit removes unrelated prose.** → Mitigation: replace only registry ownership terminology and governance examples; leave generic “collection” prose when it describes an ordinary group of things.

## Migration Plan

No data migration is required. Existing unscoped manifests, caches, lockfiles, and built artifacts remain valid. The implementation can ship as a normal CLI/protocol change with backward-compatible grammar expansion.

Rollback is straightforward: reverting the CLI/protocol changes restores previous validation and parsing. Scoped artifacts or manifests created while the change is live would stop validating in rolled-back clients, so release notes SHOULD frame scoped names as requiring the new CLI version.

## Open Questions

None.
