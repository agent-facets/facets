import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FACETS_LOCK_FILE, loadFacetsJson, loadLockfile } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { ListView } from '../../tui/views/list/list-view.tsx'
import { writeCliError } from '../../util/errors.ts'

/**
 * `facet list` — show the facets installed in the current project.
 *
 * Pulls names + source specifiers from `facets.json`. When `facets.lock`
 * exists, prefers the resolved version from there (gives the user "what
 * actually got installed" rather than "what was requested"). For entries
 * present in facets.json but missing from the lockfile (un-installed
 * dependencies), shows the source specifier so the user knows to run
 * `facet install`.
 *
 * No network calls. No "updates available" indicator (deferred to alpha).
 */
export const listCommand: Command = {
  name: 'list',
  description: 'List installed facets',
  implemented: true,
  run: async (args, _flags) => {
    if (args.length > 0) {
      writeCliError({
        what: `facet list does not accept positional arguments (got "${args[0]}")`,
        fix: "use 'facet search <term>' to browse the registry",
      })
      return 1
    }

    const projectRoot = process.cwd()
    const facetsJsonPath = join(projectRoot, 'facets.json')

    if (!existsSync(facetsJsonPath)) {
      // "Forward-compatible" hint per the work plan: `facet init` doesn't
      // exist yet, so we point at `facet add` which lazily creates
      // facets.json on first use.
      process.stdout.write(
        [
          'No facets.json in this directory.',
          "  Try 'facet add <name>' to add one, or 'facet search' to browse.",
          '',
        ].join('\n'),
      )
      return 0
    }

    const facetsJsonResult = loadFacetsJson(projectRoot)
    if (!facetsJsonResult.ok) {
      writeCliError({
        what: 'facets.json is malformed',
        detail: facetsJsonResult.error,
        fix: 'fix the JSON syntax or schema errors and try again',
      })
      return 1
    }

    const declared = Object.entries(facetsJsonResult.data.facets)
    if (declared.length === 0) {
      process.stdout.write(
        [
          'No facets installed in this project.',
          "  Try 'facet add <name>' to add one, or 'facet search' to browse.",
          '',
        ].join('\n'),
      )
      return 0
    }

    // Look up resolved versions from the lockfile when present. Lockfile
    // misses (entry declared but not yet installed) fall back to the source
    // specifier so the user can tell at a glance which entries need
    // `facet install` to materialize.
    const lockfileResult = loadLockfile(projectRoot)
    const lockfile = lockfileResult.ok && lockfileResult.existed ? lockfileResult.data : undefined
    if (!lockfileResult.ok) {
      // Surface lockfile damage but don't block the listing — degrade to
      // showing source specifiers only.
      process.stderr.write(
        `warning: ${FACETS_LOCK_FILE} is malformed (${lockfileResult.error}); showing source specifiers instead of resolved versions\n`,
      )
    }

    const rows = declared.map(([name, source]) => {
      const lockEntry = lockfile?.facets[name]
      const value = lockEntry !== undefined ? lockEntry.version : source
      return { name, value }
    })

    const instance = render(createElement(ListView, { rows }))
    instance.unmount()
    return 0
  },
}
