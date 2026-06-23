import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const LIGHT_DESIGN_PATH = fileURLToPath(new URL('../design-light.html', import.meta.url))
const LIGHT_SERVED_PATH = '/design-light.html'
const LIGHT_ASSET_NAME = 'design-light.html'

const DARK_DESIGN_PATH = fileURLToPath(new URL('../design-dark.html', import.meta.url))
const DARK_SERVED_PATH = '/design-dark.html'
const DARK_ASSET_NAME = 'design-dark.html'

export function designSystemPlugin(): Plugin {
  return {
    name: 'design-system',
    // Emit the .html into the build output so the static-site upload serves
    // it at the apex URL the prompt body references.
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: LIGHT_ASSET_NAME,
        source: readFileSync(LIGHT_DESIGN_PATH, 'utf8'),
      })
      this.emitFile({
        type: 'asset',
        fileName: DARK_ASSET_NAME,
        source: readFileSync(DARK_DESIGN_PATH, 'utf8'),
      })
    },
    // Serve the same file at /design in dev so the hosted URL
    // works locally and edits hot-reload through Vite's `?raw` watcher.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== LIGHT_SERVED_PATH && url !== DARK_SERVED_PATH) return next()

        if (url === LIGHT_SERVED_PATH) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(readFileSync(LIGHT_DESIGN_PATH, 'utf8'))
          return
        }

        if (url === DARK_SERVED_PATH) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(readFileSync(DARK_DESIGN_PATH, 'utf8'))
          return
        }

        throw new Error('Uh oh – design system plugin is malfunctioning!')
      })
    },
  }
}
