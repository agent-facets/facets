import { defineConfig } from 'tsdown'

export default defineConfig({
  // `api-version.ts` is a separate, dependency-free entry so compatibility-
  // aware consumers can import the canonical constants without loading the
  // full SDK module graph.
  entry: ['src/index.ts', 'src/api-version.ts'],
  format: ['esm'],
  dts: {
    eager: true,
  },
  clean: true,
  deps: {
    // Both are development-only dependencies whose *types* appear in this
    // package's public surface, so they must be inlined into the generated
    // declarations — a published adapter author installs neither.
    //
    // `@agent-facets/protocol` contributes only `McpServerDeclaration`, which
    // is a plain structural type, so nothing of protocol's runtime graph
    // (arktype, nanotar, yaml) reaches the emitted JavaScript or the emitted
    // declarations. `dist.e2e.test.ts` pins that invariant.
    //
    // Deliberately the single top-level list: setting `deps.dts.alwaysBundle`
    // would *replace* this list for `.d.ts` importers rather than extend it,
    // silently re-externalizing `@agent-facets/common`.
    alwaysBundle: ['@agent-facets/common', '@agent-facets/protocol'],
  },
})
