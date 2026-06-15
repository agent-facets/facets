> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## Step Types

- **Verify** → CHECK. Run automated checks (tests, lint, type checks).
  If all checks pass, proceed. If anything fails, STOP and notify the user.
- **Implement** → WRITE. Make code changes — create, edit, or delete files.
- **Propose** → READ-ONLY + USER GATE. Present intended changes in your message text first,
  then ask for approval using the `question` tool with a short prompt (Approve / Reject / Request changes).
  Never put details in the question — the question is just the gate. Do not write anything.
- **Explore** → READ-ONLY. Read files, search the codebase, investigate broadly.
  No writes allowed. Use this to understand the problem space before acting.
- **Review** → READ-ONLY + USER GATE. Present findings and analysis in your message text first,
  then ask for feedback using the `question` tool with a short prompt.
  Never put details in the question — the question is just the gate.

## 1. Protocol facet identity grammar — Research

- [x] 1.1 Explore: Inspect existing protocol manifest schemas, compact facet parsing, archive validation, and tests to identify every place facet identity grammar is currently implicit.
- [x] 1.2 Explore: Inspect common asset-name validation and adapter asset path assumptions to confirm the new facet identity validator stays separate from asset-name validation.
- [x] 1.3 Propose: Define the protocol-level facet identity validator API, exported types, error shape, and integration points for manifest validation and archive validation.

## 2. Protocol facet identity grammar — Implementation

- [x] 2.1 Implement: Add a protocol-level facet identity validator/parser that accepts `name` and `@scope/name`, rejects malformed identities including trailing hyphens, uppercase letters, missing name segments, extra path depth, backslashes, and traversal segments, and returns typed result data instead of throwing.
- [x] 2.2 Implement: Integrate the facet identity validator into `FacetManifestSchema` while keeping asset names governed by asset-name validation.
- [x] 2.3 Implement: Export the facet identity validator through protocol's public surface and through engine where CLI authoring code needs it.
- [x] 2.4 Implement: Add protocol tests for valid unscoped identities, valid scoped identities, invalid scoped identities, malformed legacy-ish names, unknown-field preservation on re-emit, and archive validation of scoped facet manifests.
- [x] 2.5 Verify: Run focused protocol tests and typechecking for protocol identity/schema changes.

## 3. Registry source parsing and install/cache — Research

- [x] 3.1 Explore: Inspect `parseFacetSource`, version parsing, add/install manifest mutation, lockfile writing, and source-name resolution to map every branch affected by `@scope/name` and `@scope/name@version`.
- [x] 3.2 Explore: Inspect registry generated OpenAPI types and registry client helpers to identify scoped route paths and how scoped metadata/archive requests must be made without percent-encoding `@scope/name` into one path segment.
- [x] 3.3 Explore: Inspect cache identity, cache path, cache put, cache lookup, and cache audit code to identify slash-containing identity path assumptions.
- [x] 3.4 Propose: Define the install/cache approach for scoped source parsing, source recording, exact-version cache keys, scoped registry route selection, and cache parent-directory creation.

## 4. Registry source parsing and install/cache — Implementation

- [x] 4.1 Implement: Update registry source parsing so `@scope/name`, `@scope/name@latest`, `@scope/name@1.2.3`, and supported wildcard forms parse correctly, while malformed forms such as `@scope`, `@scope/`, `@scope/name@`, and unsupported ranges return typed parse failures.
- [x] 4.2 Implement: Update add/install manifest mutation and version recording so scoped bare adds pin to `@scope/name@MAJOR.MINOR.PATCH`, explicit `@scope/name@latest` preserves `latest`, and re-add behavior preserves valid existing version specs.
- [x] 4.3 Implement: Update registry metadata resolution, archive lookup, download, and publish helper routing to use the generated scoped route shape with literal `@scope` and separate facet-name path components for scoped identities.
- [x] 4.4 Implement: Update cache write behavior to create parent directories for slash-containing exact identity keys before renaming staging content into the final cache slot.
- [x] 4.5 Implement: Add install/cache/registry tests covering scoped add, malformed scoped source rejection, scoped version recording, scoped route paths with unencoded `@`, scoped archive lookup, scoped cache population, and slash-containing unscoped cache population.
- [x] 4.6 Verify: Run focused engine source-parser, install, registry, and cache tests.

## 5. Authoring create/edit/build/publish — Research

- [x] 5.1 Explore: Inspect create/edit TUI validation, form state, scaffold manifest generation, default asset-name suggestions, and edit reconciliation to map facet-identity vs asset-name validation boundaries.
- [x] 5.2 Explore: Inspect build pipeline output filename construction, build-output writing, publish artifact discovery, manifest drift detection, and publish upload flow for slash-containing identity assumptions.
- [x] 5.3 Propose: Define the authoring implementation approach for scoped create/edit validation, unscoped asset-name suggestions, build-output parent directory creation, publish drift behavior, and publish scoped upload behavior.

## 6. Authoring create/edit/build/publish — Implementation

- [x] 6.1 Implement: Update create and edit facet identity validation, hints, and error messages to accept unscoped and scoped facet identities while keeping skill, agent, and command names kebab-case only.
- [x] 6.2 Implement: Update default asset-name suggestions for scoped facet identities to use the unscoped name segment instead of the full `@scope/name` identity.
- [x] 6.3 Implement: Ensure edit treats cross-scope identity changes as normal local identity edits with no special warning.
- [x] 6.4 Implement: Update build output writing to create required parent directories under `dist/` for scoped and slash-containing unscoped facet identities.
- [x] 6.5 Implement: Ensure publish artifact discovery, manifest drift detection, and upload addressing work for scoped identities using the verified artifact's embedded identity.
- [x] 6.6 Implement: Add CLI/engine tests for scoped create validation, asset-name rejection of `@` and `/`, scoped edit identity changes, scoped build output, slash-containing unscoped build output, scoped publish drift, and scoped publish upload addressing.
- [x] 6.7 Verify: Run focused CLI and engine authoring/build/publish tests.

## 7. Documentation and terminology — Research

- [x] 7.1 Explore: Inspect `docs/specification/manifest.md`, `docs/cli/authoring/create.md`, `docs/cli/authoring/build.md`, `docs/cli/authoring/publish.md`, `docs/cli/add.md`, `docs/guides/install-facets.md`, `docs/guides/create-your-first-facet.md`, and `docs/guides/publish-a-facet.md` for name grammar, add/install, build/publish, and scoped examples.
- [x] 7.2 Explore: Audit `docs/`, root `README.md`, `openspec/specs/`, code comments, and CLI-facing text for registry-ownership uses of `collection` or collection-oriented capability names.
- [x] 7.3 Propose: Define the docs and terminology update plan, distinguishing registry ownership terminology from unrelated ordinary-English uses of “collection”.

## 8. Documentation and terminology — Implementation

- [x] 8.1 Implement: Update user-facing docs to document facet identity grammar, scoped `facet add` forms, scoped build output examples, scoped publish behavior, and the distinction between facet identity names and asset names.
- [x] 8.2 Implement: Replace registry-ownership collection terminology and collection-oriented governance examples with scope terminology while preserving unrelated generic prose.
- [x] 8.3 Implement: Update CLI help, labels, hints, and error text that still imply facet identities are kebab-case only.
- [x] 8.4 Verify: Review changed docs and CLI text for consistency with specs and design.

## 9. Final validation — Verification

- [x] 9.1 Verify: Run `bun openspec validate support-scoped-facet-names --strict` or the repository's equivalent OpenSpec validation command for the change.
- [x] 9.2 Verify: Run `bun check` for the full repository.
- [x] 9.3 Verify: Manually exercise the scoped happy path: create a facet with `@scope/name`, build it, confirm the nested `dist/@scope/name-<version>.facet` output exists, and confirm `facet add @scope/name` parses and resolves through the scoped registry route shape.
- [x] 9.4 Verify: Manually inspect the final diff to confirm no registry OpenAPI sync output changed and no collection terminology remains where it refers to registry ownership.
