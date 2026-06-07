import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildArtifactPath, runBuildPipeline, writeBuildOutput } from '@agent-facets/engine'

/**
 * Shape of the asset sets the fixture helper accepts. Each map is
 * `<asset-name> → <prompt body>`; the helper writes the body to the
 * conventional path (`skills/<name>/SKILL.md`, `agents/<name>.md`,
 * `commands/<name>.md`) and declares each in the synthesized
 * `facet.json`.
 */
interface FixtureAssets {
  skills?: Record<string, string>
  agents?: Record<string, string>
  commands?: Record<string, string>
}

interface FixtureOptions extends FixtureAssets {
  name: string
  version: string
  description?: string
}

interface FixtureResult {
  /** Absolute path of the produced `dist/<name>-<version>.facet`. */
  distPath: string
  /** Bytes of the produced `.facet` archive, as written to disk. */
  archiveBytes: Uint8Array
}

/**
 * Write a real source tree for a facet under `projectRoot` and run the
 * canonical build pipeline so a `dist/<name>-<version>.facet` exists.
 *
 * Mirrors what a user would do via `facet create` + `facet build`, but
 * without any Ink interaction. Every fixture in the publish-command
 * test suite starts from this — that way "what `facet publish` reads
 * from disk" is exactly what `runBuildPipeline` + `writeBuildOutput`
 * just produced, never a hand-rolled approximation.
 */
export async function buildFacetFixture(projectRoot: string, opts: FixtureOptions): Promise<FixtureResult> {
  const manifest: Record<string, unknown> = {
    name: opts.name,
    version: opts.version,
  }
  if (opts.description !== undefined) manifest.description = opts.description
  if (opts.skills) {
    manifest.skills = Object.fromEntries(
      Object.entries(opts.skills).map(([name]) => [name, { description: `skill ${name}` }]),
    )
  }
  if (opts.agents) {
    manifest.agents = Object.fromEntries(
      Object.entries(opts.agents).map(([name]) => [name, { description: `agent ${name}` }]),
    )
  }
  if (opts.commands) {
    manifest.commands = Object.fromEntries(
      Object.entries(opts.commands).map(([name]) => [name, { description: `command ${name}` }]),
    )
  }

  writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify(manifest, null, 2))

  if (opts.skills) {
    mkdirSync(join(projectRoot, 'skills'), { recursive: true })
    for (const [name, body] of Object.entries(opts.skills)) {
      mkdirSync(join(projectRoot, 'skills', name), { recursive: true })
      writeFileSync(join(projectRoot, 'skills', name, 'SKILL.md'), body)
    }
  }
  if (opts.agents) {
    mkdirSync(join(projectRoot, 'agents'), { recursive: true })
    for (const [name, body] of Object.entries(opts.agents)) {
      writeFileSync(join(projectRoot, 'agents', `${name}.md`), body)
    }
  }
  if (opts.commands) {
    mkdirSync(join(projectRoot, 'commands'), { recursive: true })
    for (const [name, body] of Object.entries(opts.commands)) {
      writeFileSync(join(projectRoot, 'commands', `${name}.md`), body)
    }
  }

  const result = await runBuildPipeline(projectRoot, [])
  if (!result.ok) {
    throw new Error(
      `buildFacetFixture: build failed for ${opts.name}@${opts.version}: ${result.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ')}`,
    )
  }
  await writeBuildOutput(result, projectRoot)
  const distPath = buildArtifactPath(projectRoot, opts.name, opts.version)
  const archiveBytes = await Bun.file(distPath).bytes()
  return { distPath, archiveBytes: new Uint8Array(archiveBytes) }
}

/**
 * Delete the built `.facet` for `(name, version)` from `projectRoot/dist/`.
 * Used by the "missing artifact" scenarios that want to start from a
 * fully-set-up project (manifest + assets resolvable) but with no prior
 * build output on disk.
 */
export function removeBuiltArtifact(projectRoot: string, name: string, version: string): void {
  const distPath = buildArtifactPath(projectRoot, name, version)
  rmSync(distPath, { force: true })
}

/**
 * Record of a single `fetch` call intercepted by the spy: URL, method,
 * headers, and the request body bytes. The body bytes capture matters
 * for publish-command tests — they assert structural properties of the
 * uploaded archive via `parseFacetArchive`, not just the URL/headers.
 */
export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: Uint8Array
}

/**
 * Build a `fetch`-shaped spy that records each call and returns the
 * caller-supplied response. Defaults to a 201 with an empty JSON body
 * if no responder is supplied — useful for "happy path" tests that
 * only care about the call shape, not the response.
 *
 * The returned `.calls` array is the test's window into what publish
 * uploaded. Read-only convention: tests inspect `.calls` after running
 * publish; they do not mutate it.
 */
export function createFetchSpy(responder?: (req: Request) => Response | Promise<Response>): {
  fetch: typeof globalThis.fetch
  calls: FetchCall[]
} {
  const calls: FetchCall[] = []
  const fetchSpy = (async (input: string | URL | Request, init?: RequestInit) => {
    const req =
      input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
    const body = req.body !== null ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array(0)
    calls.push({
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      body,
    })
    if (responder) return responder(req)
    return new Response(JSON.stringify({ contentHash: 'sha256:placeholder', name: 'placeholder', version: '0.0.0' }), {
      status: 201,
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch: fetchSpy, calls }
}
