import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'

/** Install an adapter bundle the compiled binary can load without workspace dependencies. */
export function installFakeAdapter(adaptersDir: string, name: string): void {
  const dir = join(adaptersDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'adapter.js'),
    `
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

function path(type, name) { return join(process.cwd(), '.${name}', type + 's', name + '.md') }

export default {
  name: '${name}',
  apiVersion: '${ADAPTER_API_VERSION}',
  mcpServers: false,
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
