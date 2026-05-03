import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeFacetName, getRegistryBaseUrl, packFacetSource } from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import {
  isRegistryErrorResponse,
  type RegistryErrorResponse,
  translateRegistryError,
} from '../../util/registry-errors.ts'

/**
 * `facet publish` — package the current directory as a `.tar.gz` and POST
 * it to the registry.
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
  implemented: true,
  run: async (args, _flags) => {
    if (args.length > 0) {
      writeCliError({
        what: `facet publish does not accept positional arguments (got "${args[0]}")`,
        fix: 'cd into the facet source directory and run `facet publish`',
      })
      return 1
    }

    const projectRoot = process.cwd()
    const manifestPath = join(projectRoot, 'facet.json')
    if (!existsSync(manifestPath)) {
      writeCliError({
        what: 'no facet.json in this directory',
        detail: `looked at ${manifestPath}`,
        fix: 'cd into a directory with facet.json or run `facet create` to scaffold one',
      })
      return 1
    }

    // Read API key BEFORE doing any work — fail fast so the user doesn't
    // wait through a tarball pack just to be told their env isn't set up.
    const apiKey = process.env.FACET_REGISTRY_API_KEY
    if (apiKey === undefined || apiKey.length === 0) {
      writeCliError({
        what: 'FACET_REGISTRY_API_KEY environment variable not set',
        fix: 'export FACET_REGISTRY_API_KEY=<key from registry admin>',
        docsUrl: 'https://agentfacets.io/errors/E_API_KEY_MISSING',
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

    const result = await postPublish({
      base: getRegistryBaseUrl(),
      name: manifest.name,
      tarball,
      apiKey,
    })

    if (result.kind === 'success') {
      process.stdout.write(`Published ${manifest.name}@${manifest.version}.\n`)
      return 0
    }

    if (result.kind === 'version-exists') {
      writeCliError({
        what: `version ${manifest.version} already exists in the registry`,
        detail: result.envelope.error,
        fix: 'bump `version` in facet.json and try again',
        docsUrl: result.envelope.docsUrl,
      })
      return 1
    }

    writeCliError(result.failure)
    return 1
  },
}

interface PublishArgs {
  base: string
  name: string
  tarball: Uint8Array
  apiKey: string
}

type PublishResult =
  | { kind: 'success' }
  | { kind: 'version-exists'; envelope: RegistryErrorResponse }
  | { kind: 'failure'; failure: import('../../util/errors.ts').CliError }

async function postPublish(args: PublishArgs): Promise<PublishResult> {
  const url = `${args.base}/packages/${encodeFacetName(args.name)}/versions`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': args.apiKey,
        'content-type': 'application/gzip',
      },
      body: args.tarball,
    })
  } catch (err) {
    return {
      kind: 'failure',
      failure: {
        what: 'registry temporarily unavailable',
        detail: err instanceof Error ? err.message : String(err),
        fix: 'try again in a moment',
        docsUrl: 'https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE',
      },
    }
  }
  if (response.ok) return { kind: 'success' }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (isRegistryErrorResponse(body)) {
    if (body.code === 'VERSION_EXISTS') return { kind: 'version-exists', envelope: body }
    return { kind: 'failure', failure: translateRegistryError(body) }
  }
  return {
    kind: 'failure',
    failure: {
      what: 'registry returned an unexpected response',
      detail: `HTTP ${response.status} ${response.statusText}`,
      fix: 'try again in a moment',
      docsUrl: 'https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE',
    },
  }
}
