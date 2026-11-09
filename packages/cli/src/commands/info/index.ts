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
 * `facet info <name>` — a summary of one facet.
 *
 * An installed facet is described from its verified local copy without
 * contacting the registry. Any other facet is described from the
 * registry's latest version, which is the only way to see it before
 * installing.
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
      ...(view.details !== undefined
        ? { identity: { owner: view.details.owner, publisher: view.details.publisher } }
        : {}),
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

/**
 * Sizes of declared non-primary files that are binary, for a view backed
 * by local bytes. A registry-backed view is not inspected: telling binary
 * from text there would mean downloading every file just to draw hints.
 */
async function binarySizesOf(view: FacetView): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  if (view.origin.kind !== 'installed' || view.origin.from === 'registry') return sizes
  for (const file of declaredFiles(view.manifest)) {
    if (file.kind === 'primary' || file.kind === 'manifest') continue
    const read = await view.readFile(file.path)
    if (read.ok && read.kind === 'binary') sizes.set(file.path, read.sizeBytes)
  }
  return sizes
}
