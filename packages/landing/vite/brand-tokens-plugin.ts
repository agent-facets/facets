import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTokensCss } from '@agent-facets/brand'
import type { Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:brand-tokens.css'
/**
 * Rollup convention: the leading NUL byte marks this id as a virtual
 * module so Vite's own loaders don't try to read it from disk.
 */
const RESOLVED_ID = `\0${VIRTUAL_ID}`

const BANNER = `/*
 * AUTO-GENERATED from @agent-facets/brand on every \`vite dev\` /
 * \`vite build\`. DO NOT EDIT — changes will be overwritten. Edit
 * packages/brand/src/colors.ts or fonts.ts instead.
 *
 * This file is gitignored and exists so your editor's CSS language
 * server can resolve \`var(--foo)\` references. At runtime the app
 * imports the virtual module \`virtual:brand-tokens.css\` which serves
 * the same content.
 */
`

type BrandTokensPluginOptions = {
  /**
   * Absolute path where the generated CSS should be written on disk.
   * The file is written on dev-server start, on every brand-source
   * change, and at the top of every production build. It exists solely
   * for the IDE's CSS language server — at runtime the app imports
   * `virtual:brand-tokens.css`, which this plugin serves.
   */
  emitPath: string
}

function renderFile(): string {
  return `${BANNER}\n${buildTokensCss()}`
}

function writeTokensFile(emitPath: string): void {
  mkdirSync(dirname(emitPath), { recursive: true })
  writeFileSync(emitPath, renderFile(), 'utf8')
}

/**
 * Expose the canonical design-token CSS from `@agent-facets/brand` as a
 * virtual CSS module. The brand package is the single source of truth —
 * `tokens.css` has been deleted; import `virtual:brand-tokens.css`
 * instead.
 *
 * In dev the virtual module re-exports the on-disk generated file via
 * `@import`, so Vite + the IDE resolve a single concrete stylesheet.
 * In production the plugin inlines the CSS directly into the virtual
 * module so no extra network request is needed.
 *
 * Brand-source edits (`packages/brand/src/**`) rewrite the on-disk file
 * and trigger a full page reload.
 */
export function brandTokensPlugin(options: BrandTokensPluginOptions): Plugin {
  const { emitPath } = options
  let isDev = false

  return {
    name: 'brand-tokens',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    buildStart() {
      writeTokensFile(emitPath)
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      if (isDev) {
        // In dev, hand Vite an @import pointing at the real file. The
        // on-disk file is also what the IDE indexes — so dev and editor
        // agree on a single source.
        return `@import "${emitPath.replace(/\\/g, '/')}";\n`
      }
      // In prod, inline so the final CSS bundle is self-contained.
      return renderFile()
    },
    configureServer(server) {
      writeTokensFile(emitPath)
      const brandSrcDir = fileURLToPath(new URL('../../brand/src', import.meta.url))
      server.watcher.add(brandSrcDir)
      server.watcher.on('change', (changedPath) => {
        if (!changedPath.startsWith(brandSrcDir)) return
        writeTokensFile(emitPath)
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}
