import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    eager: true,
  },
  clean: true,
  // Engine is private — no published tarball to worry about. We still bundle
  // @agent-facets/common because the workspace dep resolves at build time and
  // the bundled output stays consistent with the protocol/adapter pattern.
  deps: {
    alwaysBundle: ['@agent-facets/common'],
  },
})
