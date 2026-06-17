## Why

A facet author can already declare publish visibility through the manifest's `private` boolean, and the entire downstream chain — schema validation, build embedding, publish drift detection, and the version-bump-to-change-visibility discipline — already honors it. The one missing link is at the very front of the workflow: the interactive authoring tools (the create wizard and the edit workbench) surface a facet's identity fields but never surface `private`. The only way to set or flip privacy today is to hand-edit `facet.json` by hand, which the documentation itself instructs (`docs/guides/publish-a-facet.md`: "edit facet.json: set 'private': true"). That is a discoverability and safety gap: authors do not learn the field exists, cannot see their facet's current visibility while editing, and risk typos that the manifest validator only catches later. Exposing the toggle in the authoring tools closes the loop so visibility intent is a first-class, observable choice rather than tribal knowledge about a JSON field.

## What Changes

- The interactive **edit** workbench SHALL display the facet's current publish visibility (private vs. public, including the public-by-default state when `private` is omitted) alongside the identity fields, and SHALL let the author change it.
- The interactive **create** wizard SHALL let an author declare publish visibility while scaffolding a new facet, defaulting to public-by-default so the scaffolded manifest matches today's omit-the-field behavior unless the author opts into private.
- When an author leaves visibility at public-by-default, the tools SHALL preserve omission of `private` in the manifest rather than writing `private: false`, keeping the on-disk manifest identical to what an author would hand-write and consistent with the existing "omission is not synthesized" rule.
- When an author explicitly selects public after a facet was private, the tools SHALL write the manifest in a way that records the public choice; the exact on-disk representation (omit `private` vs. write `private: false`) is a design decision deferred to design.md, but both representations are already valid public declarations.
- The author SHALL be shown, at the point of toggling, that changing visibility is a manifest content change that requires a rebuild before it takes effect and a version bump if the current version is already published — reinforcing the existing publish-time drift and immutability rules rather than letting the author discover them only when publish fails.

## Non-goals

- No change to the `private` schema field, its boolean validation, build embedding, or how it travels to the registry at publish time. Those behaviors already exist and are correct; this change only adds an authoring affordance for setting the value.
- No registry-side visibility enforcement, access control, or "who can download a private facet" behavior. That is the registry's responsibility and is explicitly outside the CLI/protocol surface.
- No new top-level command (e.g., a standalone `facet private`/`facet public`). The toggle lives inside the existing authoring tools; a dedicated non-interactive command is a possible future addition, not part of this change.
- No automatic rebuild or republish triggered by toggling visibility. The toggle edits source manifest intent only; the existing build and publish steps remain separate and unchanged.

## Capabilities

### New Capabilities
<!-- None. This change adds an authoring affordance for an already-specified field; it introduces no new product domain. -->

### Modified Capabilities

- `authoring__facets`: The interactive create wizard and edit workbench requirements gain the ability to view and set the facet's publish visibility. The edit workbench's "edit facet identity fields" behavior and the create wizard's identity-collection behavior are extended to include visibility, and the "omission is not synthesized" guarantee is preserved when the author leaves visibility public-by-default.

## Impact

- **Specs**: `openspec/specs/authoring__facets/spec.md` — the create-wizard and edit-workbench requirements are extended with visibility-toggle scenarios.
- **Code**: the CLI authoring/edit views (`packages/cli/src/tui/`) and the engine's edit/scaffold manifest mutations (`packages/engine/src/edit/`, `packages/engine/src/scaffold/`, `packages/engine/src/manifest/`) — to render the visibility control and write the chosen value through the existing pure manifest-mutation path.
- **Documentation**: `docs/guides/publish-a-facet.md` currently tells authors to hand-edit `facet.json` to change visibility (the "Making a published facet private (or public)" section). That guidance MUST be updated to describe the new in-tool toggle while still explaining the rebuild + version-bump discipline. `docs/specification/manifest.md`'s Privacy section SHOULD note that the field is now author-settable through the tools, not only by hand-editing. No change to `docs/specification/publish.md` behavior is expected, since publish-time handling is unchanged.
- **Dependencies / APIs**: none. No new packages, no registry API changes, no schema changes.
