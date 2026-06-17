## Context

Facet privacy intent belongs in `facet.json` because the manifest is the author-facing source of truth and is embedded in the built `.facet` artifact that publish verifies and uploads. Today the published facet manifest schema recognizes identity, description, author, text assets, composed facets, and server references, while tolerating unknown fields for forward compatibility. That tolerance is not enough for private facets: `private` must become a recognized schema field so authors get validation, generated types expose the value, build embeds it as manifest content, and publish can carry it to the registry without a side channel.

The relevant code path is intentionally layered:

- `packages/protocol/src/schemas/facet-manifest.ts` defines the normative `FacetManifestSchema` and inferred `FacetManifest` type.
- `packages/protocol/src/loaders/facet.ts` validates raw manifest bytes and resolves prompt content into `ResolvedFacetManifest`.
- `packages/engine/src/build/pipeline.ts` loads the source manifest, validates build content, and embeds the original `facet.json` text in the archive.
- `packages/cli/src/commands/publish/index.ts` verifies the built archive, reads the embedded manifest, detects source-vs-artifact drift via `detectManifestDrift`, and uploads the artifact unchanged.

Because the embedded `facet.json` is part of the inner archive, `private` participates in the artifact's canonical content fingerprint. Changing `private` is therefore a real content change, not publish-only metadata.

Documentation currently describes manifest fields and publish behavior in `docs/specification/manifest.md`, `docs/specification/publish.md`, and `docs/guides/publish-a-facet.md`; all three need updates so docs remain aligned with the schema.

## Goals / Non-Goals

**Goals:**

- Define a recognized optional top-level `private` boolean in the facet manifest schema.
- Preserve public-by-default compatibility: omitted `private` and `private: false` both mean public.
- Reject non-boolean `private` values during manifest validation.
- Preserve `private` through validation, prompt resolution, build archive embedding, archive verification, and publish drift detection.
- Document that `private` is author intent carried to the registry; registry-side enforcement remains the registry's responsibility.

**Non-Goals:**

- No registry authorization, access-control, search-filtering, billing, or download-enforcement implementation.
- No CLI publish flag, wizard prompt, or interactive editor control for setting privacy in this change.
- No `visibility` string discriminator or additional states such as `unlisted`, organization-scoped, or invite-only visibility.
- No migration of existing registry records.

## Decisions

### Decision: Model privacy as `private?: boolean`

The manifest SHALL use an optional top-level `private` boolean. `true` means the author intends to publish privately; `false` and omission both mean public.

**Rationale:** The near-term registry model is two-state: public or private. A boolean is the smallest representation that matches that product model, is easy to explain in author-facing JSON, and keeps the manifest contract stable for existing public facets. This design intentionally does not reserve a broader visibility model for hypothetical future audience states.

**Alternatives considered:**

- `visibility: "public" | "private"`: more extensible, but it pre-optimizes for audience states that are explicitly out of scope. It also creates a wider protocol concept before registry semantics exist.
- Required `private: false` for public facets: explicit, but it would create unnecessary churn for every existing manifest and make public-by-default compatibility harder to communicate.
- A nested `registry` or `publish` object: more expandable, but there is no other publish-time manifest metadata today. A flat top-level field matches the current manifest shape.

### Decision: Omission means public without schema-injected defaults

The schema SHALL accept omitted `private`, `private: false`, and `private: true`, but SHALL NOT inject `private: false` into validated manifest values when the field is omitted. Public-by-default behavior is semantic interpretation, not manifest mutation.

**Rationale:** Tooling treats `facet.json` as the source of truth and publish compares source and embedded manifests structurally. A schema-level default that materializes `private: false` would make the validated object differ from the author's on-disk manifest, risking false content-drift detection or accidental re-emission of a field the author did not write.

**Alternatives considered:**

- Arktype/default-level `private = false`: rejected because it turns an omitted field into present manifest data.

### Decision: Recognize `private` in protocol, not engine or CLI

`FacetManifestSchema` SHALL own the field definition and type validation. Engine and CLI should receive the value through `FacetManifest` rather than maintaining their own parsing or validation rules.

**Rationale:** Manifest shape is part of the published facet artifact specification. Protocol is the single source of truth for schemas and bytes validators, and registry implementations can consume the same protocol package when validating uploads. Recognition also turns author typos such as `private: "true"` into local, field-pathed validation errors instead of silently tolerated unknown data that only fails at the registry.

**Alternatives considered:**

- CLI-only handling during `facet publish`: rejected because it would create an out-of-band publish setting instead of embedding author intent in the artifact.
- Registry-only handling of unknown manifest fields: rejected because authors would not get local validation and TypeScript consumers would not see `private` in the manifest type.

### Decision: Preserve `private` in `ResolvedFacetManifest`

`ResolvedFacetManifest` SHOULD gain `private?: boolean`, and `resolvePromptsFromMap` SHOULD copy the field from the validated manifest when it is present.

**Rationale:** The built archive embeds the original `facet.json` text, so archive bytes would carry `private` even without this change. However, `ResolvedFacetManifest` is returned by build and consumed by downstream tooling/tests as the resolved representation of the manifest. Omitting a recognized top-level manifest field there would create a subtle second representation that loses visibility intent.

**Alternatives considered:**

- Only update `FacetManifest`: smaller, but violates the single-source-of-truth expectation for resolved manifest data.

### Decision: Let existing drift detection classify privacy edits as content drift

No new drift branch is needed. `detectManifestDrift` already compares validated manifests structurally after checking `name` and `version`; changing `private` after build will be classified as `reason: 'content'`.

**Rationale:** Privacy intent is manifest content. Reusing the existing content-drift behavior keeps publish prompts and non-interactive warnings consistent with edits to description or asset descriptors. Because `facet.json` participates in the artifact content fingerprint, flipping `private` also produces a different artifact; publishing that changed artifact under an already-published version should collide with registry immutability just like any other manifest edit. Authors must bump the version when publishing a visibility change to an already-published facet.

**Alternatives considered:**

- Add a privacy-specific drift reason: rejected for this change because it expands CLI surface area without changing the user's available choices. The user still chooses whether to rebuild or publish the existing artifact unchanged.

### Decision: Do not change adjacent artifact schemas

The lockfile, project manifest, build manifest, and server manifest schemas SHALL NOT gain visibility fields as part of this change.

**Rationale:** Facet privacy is publish-time author intent carried inside the facet manifest. Install-time artifacts do not decide whether a caller is authorized to see or download a private facet; the registry gates access before an installer receives metadata or bytes. The existing build manifest already fingerprints the embedded `facet.json`, so no separate build-manifest field is needed.

### Decision: Document registry responsibility without duplicating registry policy

Docs SHALL explain that `private` travels in the embedded manifest and is submitted during publish, while registry-side authorization and visibility enforcement are outside this repo's CLI/protocol change.

**Rationale:** The CLI publishes verified artifact bytes; it does not enforce registry audience policy. Documentation should prevent authors from assuming local tooling alone makes a facet private.

## Risks / Trade-offs

- **Risk: Authors assume `private: true` alone enforces access control locally.** → Mitigation: docs and publish wording will state that the field expresses author intent and that the registry accepts, rejects, or enforces private visibility.
- **Risk: Future audience states appear after choosing a boolean.** → Mitigation: the change intentionally scopes to the current two-state registry model. Future richer visibility semantics can be introduced as a separate protocol change if the product model changes.
- **Risk: Existing tooling preserves unknown fields but does not understand `private`.** → Mitigation: omission remains public, and older tooling already tolerates unknown fields; newer tooling recognizes and validates the field.
- **Risk: Resolved manifest and embedded manifest diverge.** → Mitigation: update `ResolvedFacetManifest` alongside `FacetManifest` so recognized manifest-level metadata is not dropped from the resolved representation.
- **Risk: Authors try to flip visibility for an already-published version.** → Mitigation: document that `private` changes artifact content and therefore requires the same version-bump discipline as other manifest edits.
- **Risk: Authors edit `private` in source but publish a stale `dist/` artifact.** → Mitigation: existing content-drift prompts and non-interactive warnings already cover source-vs-embedded manifest mismatch; add `private` to docs as an example of content drift.

## Migration Plan

1. Update protocol schema/types and tests to accept omitted `private`, `private: false`, and `private: true`, and reject non-boolean values without injecting a default.
2. Update manifest resolution tests so `ResolvedFacetManifest` preserves `private` when present.
3. Update publish/drift tests to cover changing `private` after build as content drift.
4. Leave lockfile, project manifest, build manifest, and server manifest schemas unchanged.
5. Update documentation in `docs/specification/manifest.md`, `docs/specification/publish.md`, and `docs/guides/publish-a-facet.md`, including a note that changing `private` after publish requires a new version.

Rollback is straightforward: remove the recognized schema field and docs updates. Existing manifests containing `private` would return to being tolerated as unknown fields by older-compatible schema behavior, but newer tests and docs would need reverting.

## Open Questions

None. The design chooses `private?: boolean`, explicitly accepts `private: false`, and relies on the registry reading visibility intent from the embedded manifest rather than a separate publish parameter.
