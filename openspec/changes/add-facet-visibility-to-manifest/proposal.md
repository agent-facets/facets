## Why

The registry API is preparing to support private facets, but facet authors currently have no manifest-level way to declare that a publish attempt is intended to create a private facet. Without a manifest field, private publishing depends on out-of-band registry configuration that the source-of-truth `facet.json` and built `.facet` artifact cannot express, so authors cannot carry privacy intent through build and publish consistently.

## What Changes

- Add an optional top-level `private` boolean for facet authors, where `private: true` marks the facet as private and `false` or omission keeps the facet public.
- Define `private` as a recognized manifest field rather than an unknown extension; non-boolean values MUST be rejected.
- Treat `private` as part of the validated facet manifest, embedded built artifact, and publish payload, so local tooling and the registry interpret the same source of truth.
- Update manifest and publish documentation to describe public-by-default behavior and how an author opts into private publishing.
- Preserve backwards compatibility for existing manifests that omit the field; they remain public and continue to validate.
- Choose a boolean rather than a broader `visibility` discriminator because the near-term registry model is public vs private only; additional audience states are out of scope for this change.

## Non-goals

- This change does not implement registry-side authorization, billing, access grants, search filtering, or private artifact download enforcement.
- This change does not define organization/team membership semantics or future visibility states such as unlisted, team-only, or invite-only.
- This change does not change the current publish authentication model beyond carrying the manifest-declared privacy intent in the artifact being uploaded.
- This change does not migrate existing published registry records; existing facets remain public unless a future registry migration explicitly changes them.

## Capabilities

### New Capabilities

_None._ This change extends existing manifest and publish behavior rather than introducing a new product domain.

### Modified Capabilities

- `protocol__schemas`: The facet manifest schema SHALL define the optional `private` boolean, reject non-boolean values, and preserve public-by-default compatibility behavior.
- `authoring__facets`: Facet authoring validation and loading SHALL accept and preserve the privacy declaration so authors receive clear feedback before build or publish.
- `publishing`: Publishing SHALL upload the already-built artifact with the embedded `private` value unchanged and SHALL rely on the registry to accept, reject, or enforce private visibility.

## Impact

- Affected protocol code includes the facet manifest schema, validated manifest type, manifest loader validation, archive verification, and any tests that assert valid or invalid manifest shapes.
- Affected engine/CLI code includes build and publish paths that compare source and embedded manifests for drift, because changing `private` after build is content drift and must be surfaced consistently with other manifest edits.
- The design artifact SHOULD document why `private?: boolean` is the chosen representation and why richer audience states such as unlisted, organization-scoped, or invite-only visibility are out of scope.
- Affected documentation includes `docs/specification/manifest.md`, `docs/specification/publish.md`, and `docs/guides/publish-a-facet.md`, which informed this proposal and will need updates to avoid drift from the schema.
- No new runtime dependency is expected.
