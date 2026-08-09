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
 */
export function installFakeAdapter(adaptersDir: string, name: string, options: { mcp?: boolean } = {}): void {
  const dir = join(adaptersDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'adapter.js'),
    `
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

function path(type, name) { return join(process.cwd(), '.${name}', type + 's', name + '.md') }

const mcpDoc = (root) => join(root, '.${name}-mcp.json')
function readMcp(root) {
  const file = mcpDoc(root)
  if (!existsSync(file)) return { servers: {} }
  return JSON.parse(readFileSync(file, 'utf8'))
}

const mcpCapability = {
  async prepare({ projectRoot, desired, previouslyOwnedNames }) {
    const doc = readMcp(projectRoot)
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
    }
    return {
      ok: true,
      preparation: {
        plan: { projectRoot, desired, previouslyOwnedNames },
        documentPaths: [mcpDoc(projectRoot)],
        outcomes,
      },
    }
  },
  async apply({ plan }) {
    const doc = readMcp(plan.projectRoot)
    const before = JSON.stringify(doc)
    const desiredNames = plan.desired.map((c) => c.name)
    for (const owned of plan.previouslyOwnedNames) {
      if (!desiredNames.includes(owned)) delete doc.servers[owned]
    }
    for (const contribution of plan.desired) doc.servers[contribution.name] = contribution.declaration
    const after = JSON.stringify(doc)
    if (before === after) return { ok: true, status: 'unchanged' }
    writeFileSync(mcpDoc(plan.projectRoot), after)
    return { ok: true, status: 'changed', changedPaths: [mcpDoc(plan.projectRoot)] }
  },
}

export default {
  name: '${name}',
  apiVersion: '${ADAPTER_API_VERSION}',
  mcpServers: ${options.mcp === true ? 'mcpCapability' : 'false'},
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(req) {
    const file = path(req.assetType, req.name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, req.content)
    return { ok: true, primaryPath: file }
  },
  async readAsset(req) {
    const file = path(req.assetType, req.name)
    if (!existsSync(file)) return { ok: false, failure: { code: 'not-found' } }
    const content = readFileSync(file, 'utf8')
    return { ok: true, asset: req.assetType === 'skill'
      ? { assetType: 'skill', content, metadata: {}, companions: {} }
      : { assetType: req.assetType, content, metadata: {} } }
  },
  async deleteAsset(req) {
    const file = path(req.assetType, req.name)
    const existed = existsSync(file)
    rmSync(file, { force: true })
    return { ok: true, existed, deletedPaths: existed ? [file] : [] }
  },
}
`,
  )
}
