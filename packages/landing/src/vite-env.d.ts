/// <reference types="vite/client" />

/**
 * Injected by `vite.config.ts` via `define` — pulls the CLI package's
 * current version from `packages/cli/package.json` at build time.
 */
declare const __APP_VERSION__: string

/**
 * Virtual CSS module supplied by the `brand-tokens` Vite plugin (see
 * `vite/brand-tokens-plugin.ts`). Resolves to the output of
 * `buildTokensCss()` from `@agent-facets/brand` so the brand package is
 * the single source of truth for design tokens.
 */
declare module 'virtual:brand-tokens.css'
