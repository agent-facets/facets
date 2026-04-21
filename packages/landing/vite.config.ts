import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { brandTokensPlugin } from './vite/brand-tokens-plugin'

// Inject the CLI package's version at build time so the hero eyebrow can
// display the shipped CLI version. The CLI is the user-facing artifact;
// the landing is just its marketing surface.
const cliPkgUrl = new URL('../cli/package.json', import.meta.url)
const cliPkg = JSON.parse(readFileSync(fileURLToPath(cliPkgUrl), 'utf8')) as { version: string }

// Absolute path where the brand-tokens plugin emits its on-disk copy of
// the generated CSS (for IDE consumption). The runtime path is the
// virtual module `virtual:brand-tokens.css`; the on-disk file exists so
// editors can resolve `var(--foo)` references.
const tokensEmitPath = fileURLToPath(new URL('./src/styles/tokens.generated.css', import.meta.url))

export default defineConfig({
  plugins: [react(), brandTokensPlugin({ emitPath: tokensEmitPath })],
  define: {
    __APP_VERSION__: JSON.stringify(cliPkg.version),
  },
  server: {
    port: 3000,
  },
})
