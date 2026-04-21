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

export default defineConfig({
  plugins: [react(), brandTokensPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(cliPkg.version),
  },
  server: {
    port: 3000,
  },
})
