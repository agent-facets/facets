import { defineConfig } from 'tsdown'
import { dtsTsconfigPath, tscPath } from '../../../tsdown.shared.ts'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  tsconfig: dtsTsconfigPath,
  dts: {
    tsgo: { path: tscPath },
  },
  clean: true,
  // Inline runtime dependencies so the published dist/index.mjs is a fully
  // self-contained bundle. The CLI loads this file directly at install time
  // without needing a node_modules tree.
  deps: {
    alwaysBundle: ['@agent-facets/adapter', 'arktype', 'smol-toml'],
  },
})
