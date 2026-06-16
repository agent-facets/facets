import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * The agent prompt lives at `packages/landing/src/agent-prompt.txt` so the
 * AgentPromptButton can import its body via `?raw` (Vite forbids `?raw`
 * imports from `public/`). But the prompt is ALSO served as a static asset
 * at https://agentfacets.io/agent-prompt.txt — the button copies the body
 * verbatim, and that body self-references its own canonical URL so an agent
 * can re-fetch the latest copy.
 *
 * This plugin bridges the two: it emits the same `src/` file to
 * `dist/agent-prompt.txt` at build time (so the static-site upload serves
 * it at the apex), and serves it at `/agent-prompt.txt` in dev so the
 * self-referencing URL resolves locally too. Single source of truth — one
 * file feeds both the inlined `?raw` import and the hosted URL.
 */

const PROMPT_PATH = fileURLToPath(new URL('../src/agent-prompt.txt', import.meta.url))
const SERVED_PATH = '/agent-prompt.txt'
const ASSET_NAME = 'agent-prompt.txt'

export function agentPromptPlugin(): Plugin {
  return {
    name: 'agent-prompt',
    // Emit the .txt into the build output so the static-site upload serves
    // it at the apex URL the prompt body references.
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: ASSET_NAME,
        source: readFileSync(PROMPT_PATH, 'utf8'),
      })
    },
    // Serve the same file at /agent-prompt.txt in dev so the hosted URL
    // works locally and edits hot-reload through Vite's `?raw` watcher.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== SERVED_PATH) return next()
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(readFileSync(PROMPT_PATH, 'utf8'))
      })
    },
  }
}
