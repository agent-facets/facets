## Why

The CLI's registry client hand-codes its request and response types in `packages/cli/src/util/registry-client.ts` and `packages/core/src/registry/types.ts`. The registry server (`facet-cafe`) auto-generates an OpenAPI specification from its actual route handlers and publishes it at `https://api.facet.cafe/v0/openapi.yaml`. The two are in sync today only because one team writes both sides; nothing prevents drift, and nothing forces the registry's published OpenAPI to be authoritative.

Two consequences of the current setup:

- A registry response shape change can land without breaking the CLI build, surfacing as a runtime error users see in the field.
- Adding a new registry endpoint requires duplicating types in the CLI by hand. This costs developer time and creates an unnecessary opportunity for typos and mismatched field names.

This change makes the registry's published OpenAPI specification the source of truth for the CLI's view of the registry surface. The CLI's TypeScript types for registry interactions are generated from a vendored snapshot of that OpenAPI; updating to a newer registry API is a single command that re-syncs the snapshot and regenerates types. Any drift between what the CLI expects and what the registry actually serves becomes visible at build time, in a PR, against typed code — not at runtime against a user.

## What Changes

- A vendored snapshot of the registry's OpenAPI specification is committed to the CLI package.
- A codegen script (`bun cli:sync-registry-types` or similar) fetches the latest OpenAPI from a configurable URL (defaults to production cafe), overwrites the vendored snapshot, and regenerates TypeScript types from it. Generated types are committed to the repo so fresh clones build without network access.
- The CLI's hand-coded registry types are replaced with imports from the generated module. The hand-rolled `registryFetch` wrapper continues to provide retry/timeout/error-translation behavior; only the type surface changes.
- The hand-coded registry types in `packages/core/src/registry/types.ts` (`RegistryMetadata`, `RegistrySpec`, `RegistryError`, `RegistryResult`) are reframed: the externally-shaped types that mirror the wire format come from the generated module, while internal-only types (CLI-side discriminated result wrappers, the parsed `VersionSpec`-keyed input form for batch resolution) stay hand-coded as they describe the CLI's internal contract, not the wire.
- A CI check verifies the vendored OpenAPI snapshot is no more than N days stale relative to the live registry, and warns (does not fail) when it is. The threshold is configurable; initial value to be set in design.
- The codegen choice is `openapi-typescript` (types-only, no runtime). The CLI continues to use `fetch` directly via the existing `registryFetch` wrapper.

## Capabilities

### New Capabilities

None. This change introduces no new product domain — it is an implementation choice for how the CLI consumes an existing external service.

### Modified Capabilities

- `cli`: The CLI's registry interactions MUST derive their type contract from the registry's published OpenAPI specification rather than from hand-coded types. The user-observable value is that the CLI's understanding of the registry stays in lockstep with the registry's actual API surface — a registry response field that disappears or changes shape is caught at build time, not as a runtime "unexpected response" error in front of a user.

## Non-goals

- **Adopting date-versioned API pinning** (e.g. `/openapi/v0?date=2026-04-22`). The registry has not yet implemented date-versioning; this change targets the current `/v0/openapi.yaml` endpoint. When date-versioning lands at the registry, adding the date pin is an addition to the sync script, not a redesign.
- **Bifurcating CLI and registry release cadences.** Today, CLI and registry release together; this change does not change that. It does build the foundation that lets us bifurcate later by giving the CLI a typed client whose contract is owned externally.
- **Switching to a heavier OpenAPI client generator** (e.g. `orval`, `openapi-zod-client`). The CLI's HTTP needs are simple — typed `fetch` is sufficient. A heavier generator can be evaluated later if the registry surface grows complex enough to warrant it.
- **Runtime response validation.** Generated types are compile-time only; there is no runtime check that responses match the schema. If a runtime check becomes valuable (e.g. for a third-party CLI that doesn't trust the registry), it can be added later.
- **Replacing the existing `registryFetch` wrapper.** The retry/timeout/error-translation logic is unchanged. Only the type surface around it changes.
- **Generating client code for `facet-cafe` itself.** Cafe owns its own implementation; this change is purely about CLI-side consumption.
- **Publishing a `@agent-facets/registry-client` npm package.** The vendored-snapshot approach keeps codegen entirely inside the CLI package. Extracting to a separately-published package is a heavier coordination move that we MAY revisit if/when third-party CLI consumers materialize.

## Documentation referenced

- `docs/docs/contributing/release-pipeline.md` — describes how releases work; SHOULD be updated to mention the OpenAPI sync step as part of the CLI's release prep checklist (so a CLI release doesn't ship with a stale registry view).
- `docs/docs/contributing/getting-started.md` — describes contributor setup; SHOULD be updated to mention the codegen script and the vendored snapshot location, so contributors know how to refresh types when the registry changes.
- `packages/cli/AGENTS.md` — describes CLI package responsibilities; MUST be updated to document the registry-types codegen workflow and the rule that generated files are committed.
- `packages/landing/public/agent-prompt.txt` — already references `https://api.facet.cafe/v0/openapi.yaml` as the registry's API spec URL, which is the same URL this change will sync from. No update required, but the reference confirms the URL is publicly documented and stable.
- No relevant `openspec/specs/` content exists today describing CLI/registry type contracts — the hand-coded types are an implementation detail not surfaced as a requirement. The `cli` spec gains a small requirement reflecting the new external-source-of-truth rule.

## Impact

- **Build-time tooling**: A new dev dependency on `openapi-typescript`. The codegen script lives in `packages/cli/scripts/` (or root `scripts/cli/`); exact location decided in design.
- **Vendored artifact**: One committed file (`packages/cli/src/util/registry-openapi.yaml` or `.json` — design decides format). Reviewable in PRs, deterministic, no network needed for fresh-clone builds.
- **Generated code**: One committed file (`registry-types.gen.ts` or similar). Marked clearly as generated; covered by lint/format like any source file but never hand-edited.
- **CI**: One additional lint-style check that compares vendored snapshot timestamp/hash to the live OpenAPI URL. Warns rather than fails to avoid blocking PRs when the registry is briefly down or behind a deploy.
- **Type changes**: `packages/core/src/registry/types.ts` shrinks; the externally-shaped types move to imports from the generated module. The CLI-side discriminated result wrappers (`RegistryFetchResult`, `RegistryResult<T>`) remain hand-coded.
- **No user-visible behavior change**. The CLI continues to call the same endpoints with the same request shapes and produce the same error messages. The change is purely about where the type definitions originate.
- **Foundation for future evolution**: When the registry adopts date-versioned API pinning, the sync script gains a date parameter — no other CLI surface changes. When CLI and registry release cadences bifurcate, the typed client makes that safe to do.
