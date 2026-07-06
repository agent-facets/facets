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
  // @agent-facets/common is a private workspace package — inline its code
  // into the protocol bundle so the published @agent-facets/protocol tarball
  // has no runtime dependency on common. Mirrors the adapter SDK's bundling
  // pattern. Keeping common private preserves the "internal primitive"
  // framing while still letting protocol + adapter + CLI share one copy of
  // helpers like validateAssetName, normalizeLineEndings, atomicWriteFileSync.
  deps: {
    alwaysBundle: ['@agent-facets/common'],
  },
})
