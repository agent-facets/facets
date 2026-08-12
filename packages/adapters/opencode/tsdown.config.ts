import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    eager: true,
  },
  clean: true,
  // Inline runtime dependencies so the published dist/index.mjs is a fully
  // self-contained bundle. The CLI loads this file directly at install time
  // without needing a node_modules tree.
  deps: {
    alwaysBundle: ['@agent-facets/adapter', '@agent-facets/adapter-jsonc', 'arktype', 'jsonc-parser'],
  },
  inputOptions: {
    // `jsonc-parser` has no `exports` map, so the default field order resolves
    // it to its UMD build — whose lazy `require('./impl/...')` calls cannot be
    // resolved from `dist/` once bundled. Preferring `module` picks the ESM
    // build, which bundles into a single self-contained file.
    // `dist.e2e.test.ts` exercises the write path, which is where the UMD
    // build fails.
    resolve: { mainFields: ['module', 'main'] },
  },
})
