import { loadFacetView, resolveSelector } from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { safeText, shellQuote, toTerminalSafe } from '../../util/terminal-safe.ts'
import { facetViewError } from '../shared/facet-view-errors.ts'

/**
 * `facet cat <name> <asset-or-path>` — print one skill, command, agent,
 * or declared file of a facet, and nothing else, on stdout.
 *
 * Reads the same verified local copy `facet info` shows. A selector
 * only ever reaches a path the facet's manifest declares.
 */
export const catCommand: Command = {
  name: 'cat',
  description: "Print one of a facet's skills, commands, agents, or files",
  usage: '<name> <asset-or-path>',
  implemented: true,
  flags: {
    path: { type: 'boolean', description: 'Print the local path of an installed file instead of its content' },
  },
  run: async (args, flags) => {
    const [name, selector] = args
    if (args.length !== 2 || name === undefined || selector === undefined) {
      writeCliError({
        what: `facet cat takes a facet name and an asset or file (got ${args.length} argument${args.length === 1 ? '' : 's'})`,
        fix: 'run: facet cat <name> <asset-or-path>',
      })
      return 1
    }
    const projectRoot = process.cwd()

    const loaded = await loadFacetView(projectRoot, name)
    if (!loaded.ok) {
      writeCliError(facetViewError(projectRoot, name, loaded.failure))
      return 1
    }
    const view = loaded.view

    const resolved = resolveSelector(view.manifest, selector)
    switch (resolved.kind) {
      case 'ambiguous':
        writeCliError({
          what: `"${safeText(selector)}" matches more than one asset in ${name}`,
          detail: resolved.candidates.join(', '),
          fix: `run: facet cat ${shellQuote(name)} ${shellQuote(resolved.candidates[0] ?? '')}`,
        })
        return 1
      case 'server-only':
        writeCliError({
          what: `"${safeText(selector)}" is an MCP server, which has no content to print`,
          fix: `run: facet info ${shellQuote(name)}`,
        })
        return 1
      case 'not-found':
        writeCliError({
          what: `"${safeText(selector)}" matches nothing in ${name}`,
          detail: `printable: ${safeText(resolved.printable.join(', '))}`,
          fix: `run: facet info ${shellQuote(name)}`,
        })
        return 1
      case 'file':
        break
    }
    const path = resolved.file.path

    if (flags.path === true) {
      const local = await view.localPath(path)
      if (local === undefined) {
        writeCliError({
          what: `no verified local copy of ${safeText(path)} in "${name}" is available`,
          detail: 'the file is missing, or is a link or resolves outside the facet',
          fix: 'run: facet install',
        })
        return 1
      }
      process.stdout.write(`${process.stdout.isTTY ? safeText(shellQuote(local)) : local}\n`)
      return 0
    }

    const read = await view.readFile(path)
    if (!read.ok) {
      writeCliError(
        read.code === 'unsafe'
          ? {
              what: `refusing to read ${safeText(path)} from ${name}`,
              detail: 'it is a link or not a regular file, or it resolves outside the facet',
              fix: 'remove the link from the facet source, then try again',
            }
          : { what: `could not read ${safeText(path)} from ${name}`, fix: 'run: facet install' },
      )
      return 1
    }
    if (read.kind === 'binary') {
      writeCliError({
        what: `${safeText(path)} is a binary file (${read.sizeBytes} bytes), so it is not printed`,
        fix:
          (await view.localPath(path)) !== undefined
            ? `run: facet cat --path ${shellQuote(name)} ${safeText(shellQuote(selector))}`
            : `run: facet add ${shellQuote(name)}`,
      })
      return 1
    }

    if (!process.stdout.isTTY) {
      process.stdout.write(read.content)
      return 0
    }
    const shown = toTerminalSafe(read.content)
    process.stdout.write(shown.text)
    if (shown.escaped > 0) {
      process.stderr.write(
        `note: ${shown.escaped} character${shown.escaped === 1 ? '' : 's'} shown as escapes; redirect output for raw bytes\n`,
      )
    }
    return 0
  },
}
