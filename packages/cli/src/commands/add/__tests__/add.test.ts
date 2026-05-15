import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureStderr } from '../../../__tests__/helpers/capture-std.ts'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import { addCommand } from '../index.ts'

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
  originalAdaptersDir = process.env.FACET_ADAPTERS_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-add-cli-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  adaptersDir = join(fakeHome, '.facet', 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_ADAPTERS_DIR = adaptersDir
  process.chdir(projectRoot)
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalAdaptersDir === undefined) delete process.env.FACET_ADAPTERS_DIR
  else process.env.FACET_ADAPTERS_DIR = originalAdaptersDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('facet add — happy path', () => {
  test('adds a local facet, writes facets.json + lockfile, materializes assets', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const fixture = buildLocalFixture('viper-plans')
    const relPath = `./${fixture.split('/').pop()}`

    const code = await addCommand.run([relPath], {})
    expect(code).toBe(0)

    // facets.json now contains the entry, keyed by manifest name.
    const facetsJsonPath = join(projectRoot, 'facets.json')
    expect(existsSync(facetsJsonPath)).toBe(true)
    const facetsJson = JSON.parse(readFileSync(facetsJsonPath, 'utf8'))
    expect(facetsJson.facets['viper-plans']).toBe(relPath)

    // Lockfile written by runInstall.
    const lockPath = join(projectRoot, 'facets.lock')
    expect(existsSync(lockPath)).toBe(true)
    const lockfile = JSON.parse(readFileSync(lockPath, 'utf8'))
    expect(lockfile.facets['viper-plans']).toMatchObject({
      version: '0.1.0',
      assets: [{ scope: 'project', type: 'skill', name: 'planning' }],
    })

    // Asset materialized into the fake adapter's project-scope dir.
    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)
  })

  test('multi-source: two facets are added in one command', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const a = buildLocalFixture('alpha')
    const b = buildLocalFixture('beta')
    const relA = `./${a.split('/').pop()}`
    const relB = `./${b.split('/').pop()}`

    const code = await addCommand.run([relA, relB], {})
    expect(code).toBe(0)

    const facetsJson = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    expect(facetsJson.facets.alpha).toBe(relA)
    expect(facetsJson.facets.beta).toBe(relB)

    const lockfile = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lockfile.facets.alpha?.version).toBe('0.1.0')
    expect(lockfile.facets.beta?.version).toBe('0.1.0')
  })

  test('upserts an existing entry when re-adding the same facet', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const fixture = buildLocalFixture('viper-plans')
    const rel = `./${fixture.split('/').pop()}`

    expect(await addCommand.run([rel], {})).toBe(0)
    expect(await addCommand.run([rel], {})).toBe(0)

    const facetsJson = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    // Single entry only.
    expect(Object.keys(facetsJson.facets)).toEqual(['viper-plans'])
  })
})

describe('facet add — error paths', () => {
  test('exits 1 with usage error when no source is given', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const { result: code, stderr } = await captureStderr(() => addCommand.run([], {}))
    expect(code).toBe(1)
    expect(stderr).toContain('missing source specifier')
  })

  test('exits 1 on git+ prefix (the new grammar hard-rejects it)', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const { result: code, stderr } = await captureStderr(() => addCommand.run(['git+https://example.com/repo.git'], {}))
    expect(code).toBe(1)
    expect(stderr).toContain('could not parse source')
    expect(stderr).toContain('git+ prefix')
  })

  test('exits 1 on caret range (only asterisk wildcards are supported)', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const { result: code, stderr } = await captureStderr(() => addCommand.run(['viper-plans@^1.0.0'], {}))
    expect(code).toBe(1)
    expect(stderr).toContain('could not parse source')
    expect(stderr).toContain('caret')
  })

  test('rejects a local path outside the project tree', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'outside-')))
    try {
      const { result: code, stderr } = await captureStderr(() => addCommand.run([outside], {}))
      expect(code).toBe(1)
      expect(stderr).toContain('could not resolve local source')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('no adapters + non-TTY → exits 1 with "no adapters installed"', async () => {
    // No installFakeAdapter call → adaptersDir is empty. Force non-TTY
    // explicitly so the test doesn't depend on whether `bun test` was
    // launched from a real terminal. (Earlier this test relied on the
    // runner being non-TTY; a real-terminal run hung at the picker.)
    const fixture = buildLocalFixture('viper-plans')
    const rel = `./${fixture.split('/').pop()}`
    const { result: code, stderr } = await withTTY(false, () => captureStderr(() => addCommand.run([rel], {})))
    expect(code).toBe(1)
    expect(stderr).toContain('no adapters installed')
  })

  // Skipped: in TTY mode with zero adapters, `addCommand` mounts the
  // adapter picker and waits for input. Driving the picker from inside
  // an in-process unit test would require either spying on
  // `pickAndInstallAdapters` (the cleanest contract — assert the
  // handoff happens) or simulating keypresses against a live Ink
  // mount. The picker itself is covered in isolation by
  // `install-picker.test.tsx`, so the marginal coverage here is "did
  // we route to the picker". Capturing that properly requires module
  // mocking infrastructure we don't currently have wired up — left as
  // a deliberate skip with a follow-up note.
  test.skip('no adapters + TTY → hands off to pickAndInstallAdapters', async () => {
    const fixture = buildLocalFixture('viper-plans')
    const rel = `./${fixture.split('/').pop()}`
    await withTTY(true, async () => {
      // TODO: spy on pickAndInstallAdapters and assert it was called.
      // Until then, this test is intentionally skipped — running it
      // unmodified would mount the picker and hang the suite.
      await addCommand.run([rel], {})
    })
  })
})

describe('facet add — manifest snapshot rollback', () => {
  test('parse error before any state mutation: facets.json untouched', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const before = JSON.stringify({ facets: { 'pre-existing': './fake' } })
    writeFileSync(join(projectRoot, 'facets.json'), before)

    const { result: code } = await captureStderr(() => addCommand.run(['git+https://example.com/repo.git'], {}))
    expect(code).toBe(1)

    // facets.json bytes are exactly what we wrote.
    const after = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    expect(after).toBe(before)
  })

  test('composition rejection before any state mutation: facets.json untouched', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter')
    const before = JSON.stringify({ facets: { 'pre-existing': './fake' } })
    writeFileSync(join(projectRoot, 'facets.json'), before)

    // Build a fixture that declares facets[].
    const composing = realpathSync(mkdtempSync(join(projectRoot, 'composing-')))
    writeFileSync(
      join(composing, 'facet.json'),
      JSON.stringify({
        name: 'composing',
        version: '0.1.0',
        facets: ['inner-dep@1.0.0'],
      }),
    )
    const rel = `./${composing.split('/').pop()}`

    const { result: code, stderr } = await captureStderr(() => addCommand.run([rel], {}))
    expect(code).toBe(1)
    expect(stderr).toContain('composition is not supported')

    // facets.json bytes unchanged.
    const after = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    expect(after).toBe(before)
  })
})
