import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'

/**
 * Install an adapter bundle the compiled binary can load without workspace
 * dependencies.
 *
 * `mcp` opts the bundle into the MCP server capability, storing its native
 * configuration in a JSON document of its own. The document format is
 * deliberately trivial — this fixture exists to exercise the ENGINE's
 * ordering, consent, and rollback behavior, not to re-test any real tool's
 * schema, which the first-party adapters cover themselves.
 *
 * Every capability here is read-only: it inspects, decides, and returns exact
 * per-file transitions. The CLI's transaction performs the writes, which is
 * precisely what these tests are about.
 */
export function installFakeAdapter(adaptersDir: string, name: string, options: { mcp?: boolean } = {}): void {
  const dir = join(adaptersDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'adapter.js'),
    `
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const encoder = new TextEncoder()

function base(req) { return join(req.projectRoot, '.${name}') }
function path(req) { return join(base(req), req.assetType + 's', req.name + '.md') }

/** The exact state of a path: absent, or its bytes plus permission bits. */
function stateOf(file) {
  if (!existsSync(file)) return { kind: 'absent' }
  const stats = statSync(file)
  if (!stats.isFile()) return null
  return { kind: 'regular-file', contents: new Uint8Array(readFileSync(file)), mode: stats.mode & 0o7777 }
}

function sameBytes(state, contents) {
  if (state.kind !== 'regular-file' || state.contents.length !== contents.length) return false
  for (let i = 0; i < contents.length; i++) if (state.contents[i] !== contents[i]) return false
  return true
}

const mcpDoc = (root) => join(root, '.${name}-mcp.json')
function readMcp(root) {
  const file = mcpDoc(root)
  if (!existsSync(file)) return { servers: {} }
  return JSON.parse(readFileSync(file, 'utf8'))
}

const mcpCapability = {
  async plan({ projectRoot, desired, previouslyOwnedNames }) {
    const doc = readMcp(projectRoot)
    const before = JSON.stringify(doc)
    const outcomes = []
    for (const contribution of desired) {
      const existing = doc.servers[contribution.name]
      const ownership = previouslyOwnedNames.includes(contribution.name) ? 'tracked' : 'untracked'
      if (existing === undefined) outcomes.push({ kind: 'absent', name: contribution.name, ownership })
      else if (JSON.stringify(existing) === JSON.stringify(contribution.declaration))
        outcomes.push({ kind: 'equivalent', name: contribution.name, ownership })
      else outcomes.push({ kind: 'divergent', name: contribution.name, ownership })
    }
    const desiredNames = desired.map((c) => c.name)
    for (const owned of previouslyOwnedNames) {
      if (desiredNames.includes(owned)) continue
      outcomes.push({
        kind: 'obsolete-owned',
        name: owned,
        occupancy: doc.servers[owned] === undefined ? 'absent' : 'present',
      })
      delete doc.servers[owned]
    }
    for (const contribution of desired) doc.servers[contribution.name] = contribution.declaration

    const after = JSON.stringify(doc)
    if (before === after) return { ok: true, plan: { outcomes, action: { kind: 'unchanged' } } }

    const file = mcpDoc(projectRoot)
    const expected = stateOf(file)
    if (expected === null) {
      return { ok: false, failure: { code: 'validation-failed', path: file, message: 'not a plain file' } }
    }
    return {
      ok: true,
      plan: {
        outcomes,
        action: {
          kind: 'mutate',
          mutations: [
            { kind: 'write', path: file, boundary: projectRoot, expected, contents: encoder.encode(after) },
          ],
        },
      },
    }
  },
}

const assets = {
  async planInstall(req) {
    const file = path(req)
    const expected = stateOf(file)
    if (expected === null) {
      return { ok: false, failure: { code: 'unsupported-object', path: file, detail: 'not a plain file' } }
    }
    const contents = encoder.encode(req.content)
    if (sameBytes(expected, contents)) {
      return { ok: true, plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: file } }
    }
    return {
      ok: true,
      plan: {
        occupancy: expected.kind === 'absent' ? 'absent' : 'divergent',
        primaryPath: file,
        action: {
          kind: 'mutate',
          mutations: [{ kind: 'write', path: file, boundary: base(req), expected, contents }],
        },
      },
    }
  },
  async planRemoval(req) {
    const file = path(req)
    const expected = stateOf(file)
    if (expected === null) {
      return { ok: false, failure: { code: 'unsupported-object', path: file, detail: 'not a plain file' } }
    }
    if (expected.kind === 'absent') return { ok: true, plan: { kind: 'absent', primaryPath: file } }
    return {
      ok: true,
      plan: {
        kind: 'remove',
        primaryPath: file,
        action: {
          kind: 'mutate',
          mutations: [{ kind: 'delete', path: file, boundary: base(req), expected }],
        },
      },
    }
  },
}

export default {
  name: '${name}',
  apiVersion: '${ADAPTER_API_VERSION}',
  mcpServers: ${options.mcp === true ? 'mcpCapability' : 'false'},
  assets,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
}
`,
  )
}
