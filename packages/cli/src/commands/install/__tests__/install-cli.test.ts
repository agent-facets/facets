import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import { CURRENT_LOCKFILE_VERSION } from '@agent-facets/protocol'
import { captureStderr } from '../../../__tests__/helpers/capture-std.ts'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import { installCommand } from '../index.ts'

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let adaptersDir: string
let originalFacetDir: string | undefined

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
  apiVersion: '${ADAPTER_API_VERSION}',
  mcpServers: false,
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(req) {
    const file = path(req.assetType, req.name)
    await installAssetFile({ file }, req.content, req.metadata)
    return { ok: true, primaryPath: file }
  },
  async readAsset(req) {
    try {
      const r = await readAssetFile({ file: path(req.assetType, req.name) })
      return {
        ok: true,
        asset: req.assetType === 'skill'
          ? { assetType: 'skill', content: r.content, metadata: r.metadata, companions: {} }
          : { assetType: req.assetType, content: r.content, metadata: r.metadata },
      }
    } catch {
      return { ok: false, failure: { code: 'not-found' } }
    }
  },
  async deleteAsset(req) {
    const file = path(req.assetType, req.name)
    await deleteAssetFile({ file })
    return { ok: true, existed: true, deletedPaths: [file] }
  },
}
`,
  )
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-install-cli-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  // `FACET_DIR` redirects the entire facet tree (cache, adapters, locks, bin)
  // into the test temp dir. Adapter setup uses the derived adapters/ subdir.
  const facetDir = join(fakeHome, '.facet')
  adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
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
    // A fresh install writes the current (`0.2`) lockfile schema with
    // per-materialized-file integrity records inside each asset.
    expect(lockfile.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
    expect(lockfile.facets['viper-plans']).toMatchObject({
      version: '0.1.0',
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'planning',
          files: [{ path: 'skills/planning/SKILL.md', integrity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }],
        },
      ],
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

  test('no adapters + non-TTY → exits 1 with picker-cant-run hint', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: {} }))
    const { result: code, stderr } = await withTTY(false, () => captureStderr(() => installCommand.run([], {})))
    expect(code).toBe(1)
    expect(stderr).toContain('no adapters installed')
    expect(stderr).toContain('non-interactive environment')
    expect(stderr).toContain('facet adapter install <name>')
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

describe('facet install — incompatible installed adapter gate', () => {
  /** Write an unmanaged legacy bundle with an unsupported API declaration. */
  function installIncompatibleAdapter(baseDir: string, name: string): void {
    const dir = join(baseDir, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'adapter.js'),
      `export default {
  name: '${name}',
  apiVersion: '9.9',
  supportsInstall: true,
  buildAssetMetadata() { throw new Error('contract method invoked despite incompatibility') },
  async installAsset() { throw new Error('contract method invoked despite incompatibility') },
  async readAsset() { throw new Error('contract method invoked despite incompatibility') },
  async deleteAsset() { throw new Error('contract method invoked despite incompatibility') },
}
`,
    )
  }

  test('fails with a reinstall hint and never launches the picker', async () => {
    installIncompatibleAdapter(adaptersDir, 'future-adapter')
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: {} }))

    // Even on a TTY (where the zero-adapter picker COULD run), the gate
    // must report the incompatible adapter instead of launching it.
    const { result: code, stderr } = await withTTY(true, () => captureStderr(() => installCommand.run([], {})))
    expect(code).toBe(1)
    expect(stderr).toContain('future-adapter')
    expect(stderr).toContain('9.9')
    expect(stderr).toContain('facet adapter install future-adapter')
    expect(stderr).not.toContain('No AI tools are connected yet')
    // Nothing was installed or written.
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })
})

describe('facet install — unresolved collisions', () => {
  /** Two facets that both publish the project-scoped skill `planning`. */
  function twoCollidingFacets(): void {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const alpha = buildLocalFixture('alpha')
    const beta = buildLocalFixture('beta')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        facets: {
          alpha: `./${alpha.split('/').pop()}`,
          beta: `./${beta.split('/').pop()}`,
        },
      }),
    )
  }

  test('non-interactive install fails with the complete report and changes nothing', async () => {
    twoCollidingFacets()
    const before = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    const { result: code, stderr } = await withTTY(false, () => captureStderr(() => installCommand.run([], {})))

    expect(code).toBe(1)

    // Every group and every claimant, on stderr — the stream that
    // survives being piped, which is exactly the situation that produces
    // a collision with no resolver.
    expect(stderr).toContain('alpha')
    expect(stderr).toContain('beta')
    expect(stderr).toContain('"planning"')
    expect(stderr).toContain('facets["alpha"].materialization.skills["planning"]')
    expect(stderr).toContain('facets["beta"].materialization.skills["planning"]')
    expect(stderr).toContain('"kind": "aliased"')
    expect(stderr).toContain('"kind": "omitted"')
    expect(stderr).toContain('NOT changed')
    expect(stderr).toContain('code=MATERIALIZATION_COLLISION')

    // And nothing on disk moved.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    expect(existsSync(join(projectRoot, '.test-adapter'))).toBe(false)
  })

  test('a recorded alias resolves the collision without prompting', async () => {
    twoCollidingFacets()
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        manifestVersion: 0.1,
        facets: {
          alpha: manifest.facets.alpha,
          beta: {
            source: manifest.facets.beta,
            materialization: { skills: { planning: { kind: 'aliased', as: 'beta-planning' } } },
          },
        },
      }),
    )

    const code = await withTTY(false, () => installCommand.run([], {}))
    expect(code).toBe(0)

    // Both assets land, under names that differ.
    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)
    expect(existsSync(join(projectRoot, '.test-adapter/skills/beta-planning.md'))).toBe(true)
  })

  test('a recorded omission keeps the asset out of the adapter', async () => {
    twoCollidingFacets()
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        manifestVersion: 0.1,
        facets: {
          alpha: manifest.facets.alpha,
          beta: { source: manifest.facets.beta, materialization: { skills: { planning: { kind: 'omitted' } } } },
        },
      }),
    )

    const code = await withTTY(false, () => installCommand.run([], {}))
    expect(code).toBe(0)

    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)
    // Omitted, but still recorded as part of the resolved set.
    const lockfile = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lockfile.facets.beta.assets[0].materialization).toEqual({ kind: 'omitted' })
  })

  test('frozen mode reports the collision instead of opening a workspace', async () => {
    twoCollidingFacets()

    // Interactive terminal, but frozen: reproducing recorded intent must
    // never collect a new decision, so this must not hang on a prompt.
    const { result: code, stderr } = await withTTY(true, () =>
      captureStderr(() => installCommand.run([], { 'frozen-lockfile': true })),
    )

    expect(code).toBe(1)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    expect(stderr).toContain('install failed')
  })
})

describe('facet install — what an adapter is asked to write', () => {
  /**
   * An adapter that records every request it receives. The adapter API
   * does not change for aliasing, so the only way to show that the
   * effective name reaches the adapter — and that authored content does
   * not get rewritten along with it — is to look at the requests.
   */
  function installRecordingAdapter(name: string, logPath: string): void {
    const dir = join(adaptersDir, name)
    mkdirSync(dir, { recursive: true })
    const assetFsImport = require.resolve('@agent-facets/adapter')
    writeFileSync(
      join(dir, 'adapter.js'),
      `
import { installAssetFile, readAssetFile, deleteAssetFile } from '${assetFsImport}'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

function path(type, name) { return join(process.cwd(), '.${name}', type + 's', name + '.md') }
function record(kind, req) {
  appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({
    kind, assetType: req.assetType, name: req.name, content: req.content ?? null,
  }) + '\\n')
}

export default {
  name: '${name}',
  apiVersion: '${ADAPTER_API_VERSION}',
  mcpServers: false,
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(req) {
    record('install', req)
    const file = path(req.assetType, req.name)
    await installAssetFile({ file }, req.content, req.metadata)
    return { ok: true, primaryPath: file }
  },
  async readAsset(req) {
    record('read', req)
    try {
      const r = await readAssetFile({ file: path(req.assetType, req.name) })
      return { ok: true, asset: { assetType: 'skill', content: r.content, metadata: r.metadata, companions: {} } }
    } catch { return { ok: false, failure: { code: 'not-found' } } }
  },
  async deleteAsset(req) {
    record('delete', req)
    const file = path(req.assetType, req.name)
    await deleteAssetFile({ file })
    return { ok: true, existed: true, deletedPaths: [file] }
  },
}
`,
    )
  }

  test('an aliased asset is requested under its effective name, with authored content', async () => {
    const logPath = join(projectRoot, 'adapter-requests.log')
    installRecordingAdapter('test-adapter', logPath)
    const fixture = buildLocalFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        manifestVersion: 0.1,
        facets: {
          'viper-plans': {
            source: `./${fixture.split('/').pop()}`,
            materialization: { skills: { planning: { kind: 'aliased', as: 'vendor-planning' } } },
          },
        },
      }),
    )

    expect(await installCommand.run([], {})).toBe(0)

    const requests = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string; name: string; content: string | null })
    const install = requests.find((r) => r.kind === 'install')
    if (install === undefined) expect.unreachable()

    // The adapter sees the alias...
    expect(install.name).toBe('vendor-planning')
    // ...but the bytes are the publisher's, unmodified. Aliasing is a
    // placement decision; rewriting content would corrupt the very hash
    // the lockfile just verified.
    expect(install.content).toContain('# planning 0.1.0')

    // And the file lands under the alias.
    expect(existsSync(join(projectRoot, '.test-adapter/skills/vendor-planning.md'))).toBe(true)
    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(false)

    // Integrity stays anchored to the authored path.
    const lockfile = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lockfile.facets['viper-plans'].assets[0]).toMatchObject({
      name: 'planning',
      materialization: { kind: 'aliased', as: 'vendor-planning' },
      files: [{ path: 'skills/planning/SKILL.md' }],
    })
  })

  test('changing an alias deletes the old name and writes the new one', async () => {
    const logPath = join(projectRoot, 'adapter-requests.log')
    installRecordingAdapter('test-adapter', logPath)
    const fixture = buildLocalFixture('viper-plans')
    const source = `./${fixture.split('/').pop()}`
    const manifest = (as: string) =>
      JSON.stringify({
        manifestVersion: 0.1,
        facets: {
          'viper-plans': { source, materialization: { skills: { planning: { kind: 'aliased', as } } } },
        },
      })

    writeFileSync(join(projectRoot, 'facets.json'), manifest('first-name'))
    expect(await installCommand.run([], {})).toBe(0)
    expect(existsSync(join(projectRoot, '.test-adapter/skills/first-name.md'))).toBe(true)

    writeFileSync(join(projectRoot, 'facets.json'), manifest('second-name'))
    expect(await installCommand.run([], {})).toBe(0)

    // The rename is a delete plus a write, not an orphaned copy.
    expect(existsSync(join(projectRoot, '.test-adapter/skills/second-name.md'))).toBe(true)
    expect(existsSync(join(projectRoot, '.test-adapter/skills/first-name.md'))).toBe(false)
  })
})
