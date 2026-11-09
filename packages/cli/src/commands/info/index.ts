import { declaredFiles, type FacetView, loadFacetView } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InfoView } from '../../tui/views/info/info-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { canRenderLiveOutput, currentTerminalCapabilities } from '../../util/interactive.ts'
import { facetViewError } from '../shared/facet-view-errors.ts'
import { type FormatInfoInput, formatInfo, plainText } from './format.ts'
import { facetWebLink } from './web-link.ts'

const DEFAULT_WIDTH = 80

/**
 * `facet info <name>` — a summary of an installed facet, read from its
 * verified local copy without contacting the registry.
 */
export const infoCommand: Command = {
  name: 'info',
  description: "Show a summary of a facet: what it does and what's in it",
  usage: '<name>',
  implemented: true,
  run: async (args, _flags) => {
    if (args.length !== 1 || args[0] === undefined) {
      writeCliError({
        what: `facet info takes exactly one facet name (got ${args.length})`,
        fix: 'run: facet info <name>',
      })
      return 1
    }
    const name = args[0]
    const projectRoot = process.cwd()

    const loaded = await loadFacetView(projectRoot, name)
    if (!loaded.ok) {
      writeCliError(facetViewError(projectRoot, name, loaded.failure))
      return 1
    }
    const view = loaded.view

    const web = facetWebLink(view.name)
    if (web.kind === 'invalid-override') {
      process.stderr.write('warning: FACET_WEB_URL is not a valid https origin; leaving out the website link\n')
    }

    const input: FormatInfoInput = {
      view,
      binarySizes: await binarySizesOf(view),
      ...(web.kind === 'link' ? { webUrl: web.url } : {}),
    }

    if (canRenderLiveOutput(currentTerminalCapabilities())) {
      const instance = render(
        createElement(InfoView, { lines: formatInfo(input, process.stdout.columns ?? DEFAULT_WIDTH) }),
      )
      instance.unmount()
      await instance.waitUntilExit()
    } else {
      process.stdout.write(plainText(formatInfo(input, DEFAULT_WIDTH)))
    }
    return 0
  },
}

/** Sizes of declared non-primary files that are binary, read from the local copy. */
async function binarySizesOf(view: FacetView): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  for (const file of declaredFiles(view.manifest)) {
    if (file.kind === 'primary' || file.kind === 'manifest') continue
    const read = await view.readFile(file.path)
    if (read.ok && read.kind === 'binary') sizes.set(file.path, read.sizeBytes)
  }
  return sizes
}
