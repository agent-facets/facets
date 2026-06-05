import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRegistryClient, packFacetSource, publishFacetVersion, resolveCredential } from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'
import { resolveTargetDir } from '../resolve-dir.ts'

/**
 * `facet publish [directory]` — package a facet source directory as a
 * `.tar.gz` and POST it to the registry. The directory defaults to the
 * current working directory; pass a path to publish a facet elsewhere
 * (consistent with `build`, `edit`, and `create`).
 *
 * Publish does NOT mutate `facet.json`. The version published is whatever
 * is on disk; bumping the version is an explicit user action (edit
 * `facet.json` and re-run). On a 409 `VERSION_EXISTS`, we surface a
 * clean error pointing the user at the manual bump — no silent retry,
 * no auto-bump dance. Local mutations driven by a network operation
 * are surprising; we don't do them.
 *
 * Future work: a `--bump patch|minor|major` flag will reintroduce
 * version mutation as an explicit, opt-in user request that prompts
 * for confirmation before writing.
 */
export const publishCommand: Command = {
  name: 'publish',
  description: 'Publish a facet to the registry',
  usage: '[directory]',
  implemented: true,
  run: async (args, _flags) => {
    // Resolve the target directory (defaults to cwd). `facetMustExist`
    // ensures we fail with a clear message when there is no facet.json,
    // matching build/edit's directory-resolution behavior.
    const resolved = await resolveTargetDir(args[0], { mustExist: true, facetMustExist: true })
    if (!resolved.ok) {
      writeCliError({
        what: resolved.message,
        fix: 'pass a directory containing facet.json, or run `facet create` to scaffold one',
      })
      return 1
    }
    const projectRoot = resolved.dir
    const manifestPath = join(projectRoot, 'facet.json')

    // Resolve the credential BEFORE doing any work — fail fast so the
    // user doesn't wait through a tarball pack just to be told they are
    // not signed in. This is a pre-flight failure the registry never
    // sees, so the CLI authors the message itself.
    const cred = resolveCredential()
    if (cred.source === 'absent') {
      if (cred.reason?.code === 'unreadable') {
        writeCliError({
          what: "couldn't read your registry credentials file",
          detail: `${cred.reason.path}: ${cred.reason.cause}`,
          fix: "fix the file's permissions, or run `facet logout` then `facet login`",
        })
        return 1
      }
      writeCliError({
        what: 'not signed in — no registry credential found',
        fix: 'run `facet login` to sign in, or set FACET_TOKEN in your environment',
      })
      return 1
    }

    let manifest: { name: string; version: string }
    try {
      const raw = readFileSync(manifestPath, 'utf8')
      manifest = JSON.parse(raw) as { name: string; version: string }
    } catch (err) {
      writeCliError({
        what: 'facet.json is not valid JSON',
        detail: err instanceof Error ? err.message : String(err),
        fix: 'fix the JSON syntax and try again',
      })
      return 1
    }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      writeCliError({
        what: 'facet.json is missing required fields',
        detail: 'expected `name` and `version` (both strings)',
        fix: 'add both fields and try again',
      })
      return 1
    }

    const tarball = await packFacetSource(projectRoot)
    process.stdout.write(`Packed ${tarball.byteLength} bytes\n`)

    const client = createRegistryClient({ credential: cred.token })
    const result = await publishFacetVersion(client, {
      name: manifest.name,
      tarball,
    })

    if (!result.ok) {
      // Registry-dumb rendering: the registry's own error and fix text
      // are shown verbatim (a duplicate-version E_VERSION_EXISTS
      // included). The CLI keeps no local code-to-message map.
      writeCliError(translateEngineRegistryError(result.error))
      return 1
    }

    if (result.value.kind === 'queued') {
      // Accepted into the moderation queue (202). This is a success
      // outcome — render the registry's queue-acknowledgement guidance
      // verbatim and exit 0.
      process.stdout.write(`${manifest.name}@${manifest.version} was submitted for review.\n`)
      process.stdout.write(`${result.value.queued.fix}\n`)
      return 0
    }

    process.stdout.write(`Published ${manifest.name}@${manifest.version}.\n`)
    return 0
  },
}
