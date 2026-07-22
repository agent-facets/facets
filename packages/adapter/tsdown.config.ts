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
    alwaysBundle: ['@agent-facets/common'],
  },
})
