import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    eager: true,
  },
  clean: true,
  // @agent-facets/common is a private workspace package — inline its code
  // into the core bundle so the published @agent-facets/core tarball has no
  // runtime dependency on common. Mirrors the adapter SDK's bundling
  // pattern. Keeping common private preserves the "internal primitive"
  // framing while still letting core + adapter + CLI share one copy of
  // helpers like validateAssetName, normalizeLineEndings, atomicWriteFileSync.
  deps: {
    alwaysBundle: ['@agent-facets/common'],
  },
})
