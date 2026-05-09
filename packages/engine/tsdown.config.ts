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
  //
  // 'bun' is a virtual module provided by the Bun runtime, not an npm package.
  // neverBundle keeps rolldown from emitting UNRESOLVED_IMPORT warnings if a
  // bare `import ... from 'bun'` slips back in. Engine source uses the `Bun.*`
  // global form (Bun.file, Bun.Glob, etc.) per packages/engine/AGENTS.md;
  // this is defense in depth.
  deps: {
    alwaysBundle: ['@agent-facets/common'],
    neverBundle: ['bun'],
  },
})
