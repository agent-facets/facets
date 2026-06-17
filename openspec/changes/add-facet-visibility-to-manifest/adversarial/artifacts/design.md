## Context

The facet manifest (`facet.json`) is the source of truth for a facet's identity and assets. It is validated by the published `FacetManifestSchema`, embedded verbatim inside the built `.facet` archive, and — on `facet publish` — uploaded to the registry as part of that archive, with `name`/`version` read from the embedded copy rather than re-parsed from source. The registry is gaining support for private facets, but an author has no manifest-level way to state that intent today.

The reconciled proposal scopes this to a single optional top-level `private` boolean: `true` marks the facet private, `false` or omission keeps it public. Registry-side authorization, billing, search filtering, org semantics, and richer visibility states are explicitly out of scope.

Three properties of the existing system constrain the design and are easy to get wrong:

1. **The manifest is immutable to tooling.** No command (`build`, `edit`, `create`, `publish`) rewrites `facet.json`. A field that "defaults to public" MUST therefore default *semantically* at read time — the schema MUST NOT inject `private: false` into a manifest that omitted it, because that would either rewrite the author's file or create a built-vs-source mismatch.
2. **Unrecognized fields are tolerated and preserved.** `private` is loadable by older tooling today as an unknown field. This is what makes the change non-breaking; it also means "recognized" is the only new guarantee we add.
3. **The embedded manifest is inside the content-integrity hash.** The canonical fingerprint (`content_integrity`) is SHA-256 over the inner tar, which contains `facet.json`. `private` is part of that file, so its presence or value is inherently part of the artifact fingerprint — no separate plumbing carries it, and changing it changes the hash.

## Goals / Non-Goals

**Goals:**

- Add an OPTIONAL top-level `private: boolean` to the published facet manifest schema, with non-boolean values rejected and omission treated as public at the point of interpretation.
- Keep the change non-breaking: manifests that omit `private` validate exactly as before; older tooling still loads manifests that carry it.
- Ensure the author's declared `private` value travels verbatim, with zero new transport plumbing, through build → embedded archive → publish upload, exactly as `name`/`version` already do.
- Update `docs/specification/manifest.md`, `docs/specification/publish.md`, and `docs/guides/publish-a-facet.md` so documentation does not drift from the schema (Article III).

**Non-Goals:**

- Registry interpretation, authorization, or enforcement of `private`. The CLI carries intent; the registry decides.
- Any CLI flag (`--private`) or interactive wizard prompt to set visibility. The manifest is the single source of truth; the author edits the file.
- A richer `visibility` enumeration or any third audience state (unlisted, org-scoped, invite-only).
- Mutating, normalizing, or injecting `private` into the on-disk manifest by any command.

## Decisions

### Decision 1: Boolean `private`, not a `visibility` string enum

**Choice:** Represent visibility as `'private?': 'boolean'` on `FacetManifestSchema`.

**Rationale:** The near-term registry model is exactly two-valued. A boolean is the minimal faithful encoding. The cost of being wrong is bounded and recoverable: because unrecognized fields are tolerated, a future `visibility: "unlisted"` field can be *added* alongside `private` without breaking older tooling, and a precedence rule resolved then.

**Alternatives considered:**
- *`visibility: "public" | "private"` string enum now.* More future-proof against a third state, but it pays migration cost today for a state the proposal explicitly rules out of scope, and it makes the common case (public) require an explicit value or a defaulting rule. Rejected as premature — but see Open Questions, because this is the one decision a reviewer should actively confirm.
- *Top-level `private` vs. nesting under a `registry`/`publish` object.* A nested object anticipates more publish-time metadata, but there is none today; a flat top-level field matches `name`/`version`/`author` and the manifest's existing shape. Chosen: flat.

### Decision 2: Omission means public via read-time interpretation, never via schema injection

**Choice:** Treat absent `private` as public wherever visibility is interpreted. The schema MUST NOT add a default value; `build`, `edit`, `create`, and `publish` MUST NOT write `private` into a manifest the author did not author it into.

**Rationale:** Preserves the manifest-is-immutable invariant and avoids a built-vs-source mismatch. If the schema injected `private: false`, a manifest that omitted it would validate-to a different shape than it was written in, and any consumer re-emitting the manifest (or comparing source against the embedded copy) would see spurious drift.

**Alternatives considered:**
- *Schema-level default (`'private': 'boolean = false'`).* Rejected: arktype defaulting would materialize the field on the validated object, diverging the in-memory shape from the on-disk bytes and risking drift false-positives in publish's source-vs-embedded comparison.

### Decision 3: `private` is recognized, not merely tolerated — and a non-boolean is an error

**Choice:** Add `private` to the schema's known keys with type `boolean`. A `private` whose value is a string, number, or object MUST fail validation with a field-pathed error (`private must be boolean`). Omission and either boolean remain valid.

**Rationale:** "Tolerated unknown field" gives no feedback if an author writes `private: "true"` (a string). Making it recognized turns that mistake into an actionable build/validate-time error rather than a silent value the registry later rejects opaquely. This is the concrete authoring value the proposal promises ("authors receive clear feedback before build or publish").

**Alternatives considered:**
- *Leave it as an unknown tolerated field.* Rejected: no validation, no feedback, and the registry would be the first place a typo surfaces — exactly the out-of-band problem this change exists to remove.

### Decision 4: No new drift class — editing `private` post-build is ordinary content drift

**Choice:** Do not add visibility-specific drift handling. Changing `private` in source after building yields the existing **content drift** condition (same name+version, differing embedded-vs-source manifest content), handled by the existing publish prompts.

**Rationale:** `private` is manifest content; the publish flow already detects and surfaces content drift for any manifest edit. A visibility-specific path would duplicate machinery and create an inconsistent author experience. The only required work is ensuring the drift comparison treats `private` as a content-bearing field (it will, since it compares manifest content), and that docs mention visibility edits as a content-drift example.

### Decision 5: No changes to lockfile, project manifest, build-manifest, or server-manifest schemas

**Choice:** Confine the schema change to `FacetManifestSchema`. The build manifest's `integrity` already fingerprints the embedded `facet.json` (which now may carry `private`); no field is added to `build-manifest.json`, the lockfile, or `facets.json`.

**Rationale:** Visibility is a publish-time author intent, not an install-time resolution input. A consumer installing a facet does not branch on `private`; the registry gates access. Recording it in install-side artifacts would imply install-time semantics that do not exist.

## Risks / Trade-offs

- **A future third visibility state forces an additive migration.** → Mitigation: unrecognized-field tolerance means `visibility` can be added later without breaking older tooling; the precedence between `private` and a future `visibility` is deferred but tractable. Confirm in Open Questions before freezing specs.
- **`private` silently becomes part of the content fingerprint.** Toggling `private` changes `content_integrity`, so the "same" facet at the same version with flipped visibility is a different artifact and collides with registry immutability if re-published at the same version. → Mitigation: this is correct and consistent with every other manifest edit; document it as content drift requiring a version bump, exactly like editing a description.
- **Author writes `private` in source but ships a stale `dist/` built before they added it.** → Mitigation: handled by existing content-drift prompts; no new behavior. Documented as an example.
- **Older CLIs ignore `private` entirely.** An author on an old CLI who sets `private: true` gets a public publish with no warning. → Mitigation: acceptable and unavoidable for a forward-compatible field; the registry is the ultimate gate, and the field reaches it once any current CLI builds the artifact.

## Migration Plan

No data migration. Roll-out is additive and ordered so no intermediate state is broken:

1. Add `'private?': 'boolean'` to `FacetManifestSchema`; the inferred `FacetManifest` gains `private?: boolean`. Existing manifests (no `private`) validate unchanged.
2. Update the three doc surfaces (`manifest.md` field table + a short "Visibility" subsection; `publish.md` note that visibility travels in the embedded manifest and a content-drift example; `publish-a-facet.md` drift-detection note).
3. No rollback complexity: removing the field later would re-demote `private` to a tolerated unknown field, still loadable. Forward and backward compatible at every step.

## Open Questions

1. **Boolean vs. `visibility` string — final confirmation.** Is any third audience state (unlisted, org-scoped, invite-only) anticipated within the near-term registry roadmap? If yes, model `visibility: "public" | "private"` from the start to avoid an additive-but-awkward `private`+`visibility` coexistence later. If no, the boolean stands. This is the one decision that gates the `protocol__schemas` delta and SHOULD be answered before specs are frozen.
2. **Should `private: false` be explicitly accepted, or only `true` + omission?** Recommendation: accept both booleans explicitly (an author writing `false` is stating intent and SHOULD not be punished), with omission == `false` semantically. Confirm.
3. **Does the registry want visibility echoed anywhere outside the embedded manifest** (e.g., a publish request field) for its own convenience? Out of scope per the proposal, but worth a one-line confirmation that the registry will read the embedded manifest rather than expecting a separate parameter.
