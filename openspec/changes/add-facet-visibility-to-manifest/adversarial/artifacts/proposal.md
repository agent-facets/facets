## Why

The registry is gaining support for private facets, but a facet author has no way to declare, at authoring time, that a facet is intended to be private. Today the only signal the registry receives about a facet's intended audience is its name and version. An author who wants a facet kept private must rely on out-of-band registry configuration that the facet's own source tree knows nothing about — so the source-of-truth `facet.json` and the published artifact disagree about a property the author cares deeply about. We need the manifest itself to carry the author's stated intent so it travels with the built `.facet` artifact and reaches the registry verbatim on publish.

## What Changes

- The facet manifest schema gains an OPTIONAL top-level `private` boolean field. Its absence is equivalent to `private: false` (public). The field's only legal values are `true` and `false`; any non-boolean value MUST be rejected.
- Manifest validation accepts manifests with `private` present (either value) and continues to accept manifests that omit it. A manifest carrying `private` is otherwise unconstrained by this field — a private facet has the same identity, asset, and content requirements as a public one.
- The built `.facet` archive carries the author's declared `private` value verbatim in its embedded manifest. The publish flow uploads it unchanged, exactly as it already uploads `name` and `version` from the embedded manifest — so the registry reads the author's stated visibility from the artifact, not from a separate channel. This change does **not** define how the registry interprets, enforces, or authorizes private status; it defines only that the author's declared intent is carried.
- The authoring surfaces (manifest reference documentation) describe `private` as an OPTIONAL identity-adjacent field with a documented default of public.

This is intentionally the smallest viable shape: a single boolean. A boolean is sufficient **only because** the registry's audience model today is exactly two-valued (public vs. private). Whether a richer visibility model (e.g. `unlisted`, org-scoped, invite-only) is anticipated is the central open question for the design phase; if it is, a boolean would force a later breaking migration and a string-valued `visibility` discriminator would age better. The proposal commits to the boolean for now and flags the tradeoff for design.

No field is removed. No existing requirement is loosened. There are **no BREAKING changes**: because the manifest schema already tolerates and preserves unrecognized fields, older tooling that predates this change continues to load manifests that carry `private`, treating it as an unknown-but-preserved field.

## Capabilities

### New Capabilities

_None._ Facet visibility is a property of an existing artifact (the facet manifest) carried through existing flows (authoring and publishing); it does not introduce a new product domain.

### Modified Capabilities

- `protocol__schemas`: The published facet manifest schema gains the OPTIONAL `private` boolean field, with its default-when-absent semantics and value constraints stated normatively.
- `authoring__facets`: Manifest acceptance requirements acknowledge `private` as a recognized OPTIONAL field (accepted whether present or absent), so it is no longer merely tolerated as an unknown field but a defined part of the contract.
- `publishing`: The publish flow's "upload the embedded manifest verbatim" requirement is clarified to explicitly include the author's declared `private` value, so visibility intent reaches the registry unaltered.

## Impact

- **Protocol schema** (`packages/protocol/src/schemas/facet-manifest.ts`): add an optional `private: boolean` to `FacetManifestSchema`; the inferred `FacetManifest` type gains `private?: boolean`.
- **Documentation**: `docs/specification/manifest.md` (the canonical manifest reference) gains a `private` row and a short subsection documenting the public default; `docs/specification/publish.md` notes that visibility travels in the embedded manifest. Per Article III, these updates are scoped work, not drift.
- **Out of scope for code impact**: the registry's interpretation/enforcement of `private`, any CLI flag to set `private` at publish time, and any wizard prompt for visibility. The manifest is the single source of truth; tooling reads what the author wrote.
- **Dependencies / APIs**: no new dependencies. No change to the lockfile, project manifest, build-manifest, or server-manifest schemas — visibility is a publish-time author intent, not an install-time resolution property.

### Documentation reviewed

`docs/specification/manifest.md` (manifest field reference and the source-of-truth/immutability rules) and `docs/specification/publish.md` (which establishes that the upload address and embedded values come from the built artifact's embedded manifest, not a re-parse of source) directly informed this proposal.
