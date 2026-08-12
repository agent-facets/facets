import { defineConfig } from 'tsdown'

export default defineConfig({
  // `mcp-server-declaration.ts` is a separate, dependency-free entry so the
  // Adapter SDK can inline the portable declaration type into its published
  // declarations without dragging arktype's type graph along with it.
  entry: { index: 'src/index.ts', 'mcp-declaration': 'src/schemas/mcp-server-declaration.ts' },
  format: ['esm'],
  dts: {
    eager: true,
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
