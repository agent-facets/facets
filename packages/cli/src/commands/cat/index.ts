import { type FacetView, loadFacetView, resolveSelector } from '@agent-facets/engine'
import { defineCommand } from '../../command.ts'
import { writeCliError } from '../../util/errors.ts'
import type { JsonResult } from '../../util/json-output.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'
import { safeText, shellQuote, toTerminalSafe } from '../../util/terminal-safe.ts'
import { facetViewError } from '../shared/facet-view-errors.ts'
import { facetViewJsonError } from '../shared/facet-view-json.ts'

/**
 * `facet cat <name> <asset-or-path>` — print one skill, command, agent,
 * or declared file of a facet, and nothing else, on stdout.
 *
 * Reads from the same source `facet info` shows: the installed copy
 * when the project has one, the registry's latest version otherwise.
 * A selector only ever reaches a path the facet's manifest declares.
 */
export const catCommand = defineCommand({
  name: 'cat',
  description: "Print one of a facet's skills, commands, agents, or files",
  usage: '<name> <asset-or-path>',
  implemented: true,
  flags: {
    path: { type: 'boolean', description: 'Print the local path of an installed file instead of its content' },
  },
  runJson: (args, flags) => catJson(args, flags),
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
        writeCliError(
          view.origin.kind === 'installed'
            ? {
                what: `no verified local copy of ${safeText(path)} in "${name}" is available`,
                detail: 'the file is missing, or is a link or resolves outside the facet',
                fix: 'run: facet install',
              }
            : {
                what: `"${name}" is not installed, so it has no local files`,
                fix: `run: facet add ${shellQuote(name)}`,
              },
        )
        return 1
      }
      process.stdout.write(`${process.stdout.isTTY ? safeText(shellQuote(local)) : local}\n`)
      return 0
    }

    const read = await view.readFile(path)
    if (!read.ok) {
      switch (read.code) {
        case 'registry':
          writeCliError(translateEngineRegistryError(read.error))
          return 1
        case 'integrity-mismatch':
          writeCliError({
            what: `the registry's copy of "${name}" does not match what was expected`,
            detail: `expected ${read.expected}, got ${read.observed}`,
            fix: 'run: facet install',
          })
          return 1
        case 'unsafe':
          writeCliError({
            what: `refusing to read ${safeText(path)} from ${name}`,
            detail: 'it is a link or not a regular file, or it resolves outside the facet',
            fix: 'remove the link from the facet source, then try again',
          })
          return 1
        default:
          writeCliError({ what: `could not read ${safeText(path)} from ${name}`, fix: 'run: facet install' })
          return 1
      }
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
    const from = registrySourceNote(view)
    if (from !== undefined) process.stderr.write(`${from}\n`)
    if (shown.escaped > 0) {
      process.stderr.write(
        `note: ${shown.escaped} character${shown.escaped === 1 ? '' : 's'} shown as escapes; redirect output for raw bytes\n`,
      )
    }
    return 0
  },
})

/**
 * `facet cat --json`: the selected file's text, or its local path with
 * `--path`, inside the envelope. Every refusal the human path reports on
 * stderr becomes a coded error carrying its structured fields.
 */
async function catJson(args: string[], flags: Record<string, unknown>): Promise<JsonResult> {
  const [name, selector] = args
  if (args.length !== 2 || name === undefined || selector === undefined) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: `facet cat takes a facet name and an asset or file (got ${args.length} argument${args.length === 1 ? '' : 's'})`,
        fix: 'run: facet cat <name> <asset-or-path>',
      },
    }
  }
  const projectRoot = process.cwd()
  const loaded = await loadFacetView(projectRoot, name)
  if (!loaded.ok) return { ok: false, error: facetViewJsonError(projectRoot, name, loaded.failure) }
  const view = loaded.view

  const resolved = resolveSelector(view.manifest, selector)
  switch (resolved.kind) {
    case 'ambiguous':
      return {
        ok: false,
        error: {
          code: 'SELECTOR_AMBIGUOUS',
          message: `"${selector}" matches more than one asset in ${name}`,
          details: { selector, candidates: resolved.candidates },
          fix: 'select one of the candidates',
        },
      }
    case 'server-only':
      return {
        ok: false,
        error: {
          code: 'SELECTOR_IS_SERVER',
          message: `"${selector}" is an MCP server, which has no content to print`,
          details: { selector },
          fix: `run: facet info ${shellQuote(name)}`,
        },
      }
    case 'not-found':
      return {
        ok: false,
        error: {
          code: 'SELECTOR_NOT_FOUND',
          message: `"${selector}" matches nothing in ${name}`,
          details: { selector, printable: resolved.printable },
          fix: `run: facet info ${shellQuote(name)}`,
        },
      }
    case 'file':
      break
  }
  const path = resolved.file.path
  const identity = { name: view.name, version: view.version, origin: view.origin, path }

  if (flags.path === true) {
    const local = await view.localPath(path)
    if (local === undefined) {
      return {
        ok: false,
        error:
          view.origin.kind === 'installed'
            ? {
                code: 'LOCAL_COPY_UNAVAILABLE',
                message: `no verified local copy of ${path} in "${name}" is available`,
                details: { path },
                fix: 'run: facet install',
              }
            : {
                code: 'NOT_INSTALLED',
                message: `"${name}" is not installed, so it has no local files`,
                details: { path },
                fix: `run: facet add ${shellQuote(name)}`,
              },
      }
    }
    return { ok: true, data: { ...identity, localPath: local } }
  }

  const read = await view.readFile(path)
  if (!read.ok) {
    switch (read.code) {
      case 'registry': {
        const error = translateEngineRegistryError(read.error)
        return {
          ok: false,
          error: { code: read.error.code, message: error.what, fix: error.fix, docsUrl: error.docsUrl },
        }
      }
      case 'integrity-mismatch':
        return {
          ok: false,
          error: {
            code: 'INTEGRITY_MISMATCH',
            message: `the registry's copy of "${name}" does not match what was expected`,
            details: { expected: read.expected, observed: read.observed },
            fix: 'run: facet install',
          },
        }
      case 'unsafe':
        return {
          ok: false,
          error: {
            code: 'FILE_UNSAFE',
            message: `refusing to read ${path} from ${name}`,
            details: { path },
            fix: 'remove the link from the facet source, then try again',
          },
        }
      default:
        return {
          ok: false,
          error: {
            code: 'FILE_UNREADABLE',
            message: `could not read ${path} from ${name}`,
            details: { path },
            fix: 'run: facet install',
          },
        }
    }
  }
  if (read.kind === 'binary') {
    return {
      ok: false,
      error: {
        code: 'FILE_BINARY',
        message: `${path} is a binary file (${read.sizeBytes} bytes), so it is not printed`,
        details: { path, sizeBytes: read.sizeBytes },
        fix:
          (await view.localPath(path)) !== undefined
            ? `run: facet cat --path ${shellQuote(name)} ${shellQuote(selector)}`
            : `run: facet add ${shellQuote(name)}`,
      },
    }
  }
  return { ok: true, data: { ...identity, content: read.content } }
}

/** On a terminal, say when a file came from the registry rather than this machine. */
function registrySourceNote(view: FacetView): string | undefined {
  const facet = `${view.name} v${view.version}`
  if (view.origin.kind === 'registry-latest') return `note: from the registry: ${facet} (not installed)`
  if (view.origin.from === 'registry') {
    return `note: from the registry: ${facet} (your local copy is missing or damaged; run: facet install)`
  }
  return undefined
}
