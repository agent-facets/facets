import { fileURLToPath } from 'node:url'
import { buildTokensCss } from '@agent-facets/brand'
import type { Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:brand-tokens.css'
/**
 * Rollup convention: the leading NUL byte marks this id as a virtual
 * module so Vite's own loaders don't try to read it from disk.
 */
const RESOLVED_ID = `\0${VIRTUAL_ID}`

/**
 * Expose the canonical design-token CSS from `@agent-facets/brand` as a
 * virtual CSS module. The brand package is the single source of truth —
 * `tokens.css` has been deleted; import `virtual:brand-tokens.css`
 * instead.
 *
 * During dev, edits to `packages/brand/src/**` invalidate the virtual
 * module and trigger a full reload so color tweaks in the brand package
 * show up immediately.
 */
export function brandTokensPlugin(): Plugin {
  return {
    name: 'brand-tokens',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    load(id) {
      if (id === RESOLVED_ID) return buildTokensCss()
      return null
    },
    configureServer(server) {
      const brandSrcDir = fileURLToPath(new URL('../../brand/src', import.meta.url))
      server.watcher.add(brandSrcDir)
      server.watcher.on('change', (changedPath) => {
        if (!changedPath.startsWith(brandSrcDir)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}
