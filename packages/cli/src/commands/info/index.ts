import { declaredFiles, type FacetView, type InspectAssetType, loadFacetView, selectorFor } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import { defineCommand } from '../../command.ts'
import { InfoView } from '../../tui/views/info/info-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { canRenderLiveOutput, currentTerminalCapabilities } from '../../util/interactive.ts'
import type { JsonResult, JsonWarning } from '../../util/json-output.ts'
import { facetViewError } from '../shared/facet-view-errors.ts'
import { facetViewJsonError } from '../shared/facet-view-json.ts'
import { type FormatInfoInput, formatInfo, plainText } from './format.ts'
import { verifiedIdentity } from './identity.ts'
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
export const infoCommand = defineCommand({
  name: 'info',
  description: "Show a summary of a facet: what it does and what's in it",
  usage: '<name>',
  implemented: true,
  runJson: async (args) => {
    if (args.length !== 1 || args[0] === undefined) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: `facet info takes exactly one facet name (got ${args.length})`,
          fix: 'run: facet info <name>',
        },
      }
    }
    const name = args[0]
    const projectRoot = process.cwd()
    const loaded = await loadFacetView(projectRoot, name)
    if (!loaded.ok) return { ok: false, error: facetViewJsonError(projectRoot, name, loaded.failure) }
    return infoJson(loaded.view)
  },
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
      try {
        await instance.waitUntilExit()
      } finally {
        instance.unmount()
      }
    } else {
      process.stdout.write(plainText(formatInfo(input, DEFAULT_WIDTH)))
    }
    return 0
  },
})

/**
 * The `facet info` summary as data. Values are the manifest's exact
 * strings, not the wrapped display text; the JSON writer escapes
 * characters a terminal would act on.
 */
async function infoJson(view: FacetView): Promise<JsonResult> {
  const manifest = view.manifest
  const installed = view.origin.kind === 'installed'
  const files = declaredFiles(manifest)
  const binarySizes = await binarySizesOf(view)
  const fileEntry = (path: string, selector: string) => {
    const size = binarySizes.get(path)
    return size === undefined
      ? { path, selector, binary: false }
      : { path, selector: null, binary: true, sizeBytes: size }
  }

  const assets = (type: InspectAssetType, entries: Record<string, { description: string }> | undefined) =>
    Object.entries(entries ?? {}).map(([name, asset]) => {
      const primary = files.find((file) => file.kind === 'primary' && file.type === type && file.name === name)
      return {
        name,
        description: asset.description,
        disposition: installed ? view.disposition(type, name) : null,
        selector: primary === undefined ? null : selectorFor(manifest, primary),
        ...(type === 'skill'
          ? {
              files: files
                .filter((file) => file.kind === 'companion' && file.skill === name)
                .map((file) => fileEntry(file.path, file.path)),
            }
          : {}),
      }
    })

  const servers = Object.entries(manifest.servers ?? {}).map(([name, server]) => {
    const disposition = installed ? view.disposition('server', name) : null
    if (server.type === 'http')
      return { name, type: 'http', url: server.url, resolvedUrl: resolvedUrl(server.url), disposition }
    return {
      name,
      type: 'stdio',
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? {},
      disposition,
    }
  })

  const warnings: JsonWarning[] = []
  const web = facetWebLink(view.name)
  if (web.kind === 'invalid-override') {
    warnings.push({
      code: 'INVALID_WEB_URL_OVERRIDE',
      message: 'FACET_WEB_URL is not a valid https origin; leaving out the website link',
    })
  }
  const identity = verifiedIdentity(
    view.details !== undefined ? { owner: view.details.owner, publisher: view.details.publisher } : undefined,
  )

  return {
    ok: true,
    data: {
      name: view.name,
      version: view.version,
      origin: view.origin,
      description: manifest.description ?? null,
      author: manifest.author ?? null,
      owner: identity.owner,
      publisher: identity.publisher,
      skills: assets('skill', manifest.skills),
      commands: assets('command', manifest.commands),
      agents: assets('agent', manifest.agents),
      servers,
      files: files
        .filter((file) => file.kind === 'manifest' || file.kind === 'supplementary')
        .map((file) => fileEntry(file.path, selectorFor(manifest, file))),
      webUrl: web.kind === 'link' ? web.url : null,
    },
    warnings,
  }
}

/** A URL as its client resolves it, with a look-alike Unicode host in punycode form. */
function resolvedUrl(url: string): string | null {
  try {
    return new URL(url).href
  } catch {
    return null
  }
}

/**
 * Sizes of declared non-primary files that are binary, for an installed
 * facet, whose bytes are already on hand (a recovered facet's verified
 * archive included). A facet that is not installed is not inspected:
 * telling binary from text there would mean downloading every file just
 * to draw hints.
 */
async function binarySizesOf(view: FacetView): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  if (view.origin.kind !== 'installed') return sizes
  for (const file of declaredFiles(view.manifest)) {
    if (file.kind === 'primary' || file.kind === 'manifest') continue
    const read = await view.readFile(file.path)
    if (read.ok && read.kind === 'binary') sizes.set(file.path, read.sizeBytes)
  }
  return sizes
}
