---
"@agent-facets/protocol": minor
---

Add a facet identity grammar to the public API and enforce it in `FacetManifestSchema`.

New exports: `parseFacetName`, `parseSlug`, and `validateFacetName`, along with the `FacetName`, `FacetNameResult`, and `SlugResult` types. A facet identity is either an unscoped slug (`cowsay`) or a scoped `@scope/name` (`@julian/cowsay`), where every segment is a lowercase kebab slug. The parsers return discriminated-union results instead of throwing, and `parseSlug` is exported on its own so other facet-spec implementations (e.g. a registry enforcing scope ownership) validate scopes with the exact same grammar.

`FacetManifestSchema` now validates the manifest `name` field against this grammar. This tightens the previous `name: string` behavior: malformed facet identities (uppercase, leading/trailing hyphens, traversal segments, extra path depth, missing slash after `@scope`, etc.) now fail at manifest validation instead of deferring failure to build, publish, or install. Asset names remain governed separately by `validateAssetName` — asset names stay local path-safe identifiers while facet identities may carry a registry scope.
