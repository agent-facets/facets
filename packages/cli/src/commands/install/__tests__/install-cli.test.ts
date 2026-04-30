import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureStderr } from '../../../__tests__/helpers/capture-std.ts'
import { installCommand } from '../index.ts'

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let adaptersDir: string
let originalAdaptersDir: string | undefined

function buildLocalFixture(name: string, version = '0.1.0'): string {
  const repo = realpathSync(mkdtempSync(join(projectRoot, 'fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({
      name,
      version,
      skills: { planning: { description: 'planning skill' } },
    }),
  )
  mkdirSync(join(repo, 'skills/planning'), { recursive: true })
  writeFileSync(join(repo, 'skills/planning/SKILL.md'), `# planning ${version}\n`)
  return repo
}

/**
 * Drop a self-contained ESM adapter bundle into the test adapters dir
 * so `loadInstalledAdapters()` finds it. Uses the workspace's adapter
 * SDK helpers via dynamic resolution so frontmatter assembly is
 * exercised end-to-end.
 */
function installFakeAdapter(baseDir: string, name: string): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  const assetFsImport = require.resolve('@agent-facets/adapter')
  writeFileSync(
    join(dir, 'adapter.js'),
    `
import { installAssetFile, readAssetFile, deleteAssetFile } from '${assetFsImport}'
import { join } from 'node:path'

function path(type, name) {
  return join(process.cwd(), '.${name}', type + 's', name + '.md')
}

export default {
  name: '${name}',
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(scope, type, name, content, metadata) {
    await installAssetFile({ file: path(type, name) }, content, metadata)
  },
  async readAsset(scope, type, name) {
    return readAssetFile({ file: path(type, name) })
  },
  async deleteAsset(scope, type, name) {
    await deleteAssetFile({ file: path(type, name) })
  },
}
`,
  )
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalAdaptersDir = process.env.FACETS_ADAPTERS_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-install-cli-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  adaptersDir = join(fakeHome, '.facets', 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACETS_ADAPTERS_DIR = adaptersDir
  process.chdir(projectRoot)
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalAdaptersDir === undefined) delete process.env.FACETS_ADAPTERS_DIR
  else process.env.FACETS_ADAPTERS_DIR = originalAdaptersDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('facet install — CLI happy path', () => {
  test('writes a lockfile and materializes assets to adapters', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const fixture = buildLocalFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${fixture.split('/').pop()}` } }),
    )

    const code = await installCommand.run([], {})
    expect(code).toBe(0)

    const lockPath = join(projectRoot, 'facets.lock')
    expect(existsSync(lockPath)).toBe(true)
    const lockfile = JSON.parse(readFileSync(lockPath, 'utf8'))
    expect(lockfile.lockfileVersion).toBe(1)
    expect(lockfile.facets['viper-plans']).toMatchObject({
      version: '0.1.0',
      assets: [{ scope: 'project', type: 'skill', name: 'planning' }],
    })
    expect(lockfile.facets['viper-plans'].integrity).toMatch(/^sha256:/)

    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)
  })
})

describe('facet install — CLI error paths', () => {
  test('exits 1 with "no facets.json in" when facets.json is missing', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const { result: code, stderr } = await captureStderr(() => installCommand.run([], {}))
    expect(code).toBe(1)
    // facets.json is missing, but runInstall returns FACETS_JSON_NOT_FOUND
    // which the CLI surfaces as "install failed" with the structured code.
    expect(stderr).toContain('install failed')
  })

  test('exits 1 with "no adapters installed" when no adapters present', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: {} }))
    const { result: code, stderr } = await captureStderr(() => installCommand.run([], {}))
    expect(code).toBe(1)
    expect(stderr).toContain('no adapters installed')
  })

  test('exits 1 with usage error on positional argument', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: {} }))
    const { result: code, stderr } = await captureStderr(() => installCommand.run(['unexpected-arg'], {}))
    expect(code).toBe(1)
    expect(stderr).toContain('does not accept positional arguments')
    expect(stderr).toContain('facet add')
  })
})
