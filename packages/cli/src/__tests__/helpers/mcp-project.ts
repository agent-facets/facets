import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type { McpServerDeclaration } from '@agent-facets/protocol'

/**
 * Project-state helpers for the compiled-binary MCP suites.
 *
 * Every helper reads or edits a file the way a teammate, a merge, or a second
 * machine would — the point of these tests is what the CLI does with the
 * state it finds, so the state is arranged from outside, not through engine
 * internals.
 */

export interface FacetSpec {
  version?: string
  servers?: Record<string, McpServerDeclaration>
  skills?: readonly string[]
}

/** Write a local facet under `projectRoot` and return its manifest source. */
export function buildFacet(projectRoot: string, name: string, spec: FacetSpec = {}): string {
  const repo = realpathSync(mkdtempSync(join(projectRoot, `${name}-`)))
  const skills = Object.fromEntries((spec.skills ?? []).map((skill) => [skill, { description: `${skill} skill` }]))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({
      name,
      version: spec.version ?? '0.1.0',
      ...(spec.skills === undefined ? {} : { skills }),
      ...(spec.servers === undefined ? {} : { servers: spec.servers }),
    }),
  )
  for (const skill of spec.skills ?? []) {
    mkdirSync(join(repo, 'skills', skill), { recursive: true })
    writeFileSync(join(repo, 'skills', skill, 'SKILL.md'), `# ${skill}\n\nowned by ${name}\n`)
  }
  return `./${basename(repo)}`
}

export function writeManifest(projectRoot: string, value: unknown): void {
  writeFileSync(join(projectRoot, 'facets.json'), `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export interface LockedServer {
  name: string
  fingerprint: string
  materialization: { kind: string; as?: string }
}

export interface LockedFacet {
  version: string
  assets: unknown[]
  servers?: LockedServer[]
}

export interface Lockfile {
  lockfileVersion: number
  facets: Record<string, LockedFacet>
}

export function readLock(projectRoot: string): Lockfile {
  return readJson<Lockfile>(join(projectRoot, 'facets.lock'))
}

/**
 * Rewrite the lockfile as an explicit legacy document: the server inventory
 * dropped and, for `0.2`, every asset disposition too. The writer only emits
 * the current format, so a legacy lockfile can only arrive like this — from an
 * older CLI, which is what it imitates.
 */
export function relockLegacy(projectRoot: string, version: 0.2 | 0.3): void {
  const lock = readLock(projectRoot) as unknown as {
    lockfileVersion: number
    facets: Record<string, Record<string, unknown>>
  }
  lock.lockfileVersion = version
  for (const entry of Object.values(lock.facets)) {
    delete entry.servers
    if (version === 0.2) {
      for (const asset of entry.assets as Array<Record<string, unknown>>) delete asset.materialization
    }
  }
  writeFileSync(join(projectRoot, 'facets.lock'), `${JSON.stringify(lock, null, 2)}\n`)
}

/**
 * This project's machine-local receipt, found by the project path it records.
 *
 * Located by content rather than by recomputing its file name: the name is an
 * engine detail, and a test that re-derived it would keep passing against a
 * receipt the CLI no longer reads.
 */
export function receiptFile(facetDir: string, projectRoot: string): string {
  const dir = join(facetDir, 'receipts')
  const canonical = realpathSync(projectRoot)
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    if (readJson<{ path?: string }>(path).path === canonical) return path
  }
  throw new Error(`no receipt for ${canonical} under ${dir}`)
}

/** Remove every configuration claim the receipt holds for `facet`, keeping everything else. */
export function forgetConfigurationClaims(facetDir: string, projectRoot: string, facet: string): void {
  const path = receiptFile(facetDir, projectRoot)
  const receipt = readJson<{ facets: Record<string, { configurations: unknown[] }> }>(path)
  const entry = receipt.facets[facet]
  if (entry === undefined) throw new Error(`receipt records no facet ${facet}`)
  entry.configurations = []
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`)
}

/** The exact bytes (or absence) of each path, for "nothing changed" assertions. */
export function snapshot(paths: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(paths.map((path) => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]))
}

/**
 * A standard-input server whose command, if anything ever ran it, would leave
 * a marker file behind. Configuring a server must never launch it.
 */
export function sentinelServer(dir: string): { declaration: McpServerDeclaration; marker: string } {
  const marker = join(dir, 'launched.marker')
  const command = join(dir, 'sentinel-mcp.sh')
  writeFileSync(command, `#!/bin/sh\ntouch '${marker}'\n`)
  chmodSync(command, 0o755)
  return { declaration: { type: 'stdio', command, args: ['--serve'] }, marker }
}

/**
 * A loopback endpoint that counts every request it receives. Configuring an
 * HTTP server must never contact it.
 */
export function countingEndpoint(): { url: string; requests: () => number; stop: () => void } {
  let requests = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      requests++
      return new Response('unexpected')
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    requests: () => requests,
    stop: () => server.stop(true),
  }
}
