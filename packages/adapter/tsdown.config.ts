import { defineConfig } from 'tsdown'
import { dtsTsconfigPath, tscPath } from '../../tsdown.shared.ts'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  tsconfig: dtsTsconfigPath,
  dts: {
    tsgo: { path: tscPath },
  },
  clean: true,
  deps: {
    alwaysBundle: ['@agent-facets/common'],
  },
})
