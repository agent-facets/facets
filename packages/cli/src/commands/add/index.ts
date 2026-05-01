import { rm } from 'node:fs/promises'
import {
  cloneFacetGitSource,
  loadFacetsJson,
  loadManifest,
  parseFacetSource,
  resolveLocalFacetSource,
  upsertFacetInManifest,
  writeFacetsJson,
} from '@agent-facets/core'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'

/**
 * `facet add <source>` — register a facet in facets.json.
 *
 * This command is deliberately thin: it parses the source string, resolves
 * just enough of the source tree to read its `facet.json` (so we can show
 * the user the name + version they just added), and writes facets.json
 * atomically. Artifact builds and asset materialization are deferred to
 * `facet install` (Adjustment M keeps resolve/build/materialize on the
 * install side; `facet add` is a pure manifest edit).
 */

export const addCommand: Command = {
  name: 'add',
  description: 'Add a facet to the project',
  usage: '<source>',
  implemented: true,
  flags: {
    verbose: { type: 'boolean', description: 'Show detailed step output on stderr' },
  },
  run: async (args, flags) => {
    const verbose = flags.verbose === true

    const specifier = args[0]
    if (!specifier) {
      writeCliError({
        what: 'missing source specifier',
        detail: 'facet add requires a source',
        fix: 'run: facet add <source>    (e.g. facet add github:agent-facets/viper-plans#main)',
      })
      return 1
    }

    const parsed = parseFacetSource(specifier)
    if (!parsed.ok) {
      writeCliError({
        what: `could not parse source "${specifier}"`,
        detail: parsed.error,
        fix: 'use github:<owner>/<repo>[#<ref>], git+https://…, git+ssh://…, or file:./<path>',
      })
      return 1
    }

    const projectRoot = process.cwd()
    let sourceDir: string | undefined
    let cleanupGitDir = false

    try {
      if (verbose) process.stderr.write(`[verbose] resolve ${specifier}\n`)

      if (parsed.data.type === 'git') {
        const cloned = await cloneFacetGitSource(parsed.data.url, parsed.data.commitish)
        sourceDir = cloned.dir
        cleanupGitDir = true
        if (verbose) {
          process.stderr.write(`[verbose]   cloned ${parsed.data.url} → ${sourceDir} (sha: ${cloned.commit ?? '?'})\n`)
        }
      } else {
        const resolved = await resolveLocalFacetSource(parsed.data.path, projectRoot)
        if (!resolved.ok) {
          writeCliError({
            what: `could not resolve local source "${specifier}"`,
            detail: resolved.error,
            fix: 'check the path exists inside the project tree',
          })
          return 1
        }
        sourceDir = resolved.dir
      }

      const manifest = await loadManifest(sourceDir)
      if (!manifest.ok) {
        const summary = manifest.errors.map((e) => e.message).join('; ')
        writeCliError({
          what: `could not load facet.json from ${specifier}`,
          detail: summary,
          fix: 'verify the source is a facet directory with a valid facet.json',
        })
        return 1
      }

      const loaded = loadFacetsJson(projectRoot)
      if (!loaded.ok) {
        writeCliError({
          what: 'could not read facets.json',
          detail: loaded.error,
          fix: 'fix or delete the malformed facets.json and retry',
        })
        return 1
      }

      // Go through core's mutation helper rather than assigning to the
      // parsed shape directly. Keeps the CLI on the "presentation + OS I/O
      // only" side of the line stated in core/src/manifest/mutations.ts —
      // comment-json metadata survives upsert the same as direct assignment,
      // so if the helper ever grows validation or ordering logic, `facet
      // add` picks it up automatically.
      upsertFacetInManifest(loaded.data, manifest.data.name, specifier)
      writeFacetsJson(projectRoot, loaded.data)

      process.stdout.write(
        `✓ Added ${manifest.data.name}@${manifest.data.version} from ${specifier}. Run 'facet install' to materialize.\n`,
      )
      return 0
    } catch (err) {
      writeCliError({
        what: `failed to add ${specifier}`,
        detail: err instanceof Error ? err.message : String(err),
        fix: 'check the source and retry',
      })
      return 1
    } finally {
      if (cleanupGitDir && sourceDir) {
        await rm(sourceDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  },
}
