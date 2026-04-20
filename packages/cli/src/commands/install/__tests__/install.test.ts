import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCommand } from '../index.ts'

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let adaptersDir: string
let originalAdaptersDir: string | undefined

function git(args: string[], cwd?: string) {
  return Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

/**
 * Build a git fixture repo with a minimal facet definition.
 * Returns the repo path.
 */
function buildFixtureRepo(
  name: string,
  assets: { skills?: string[]; commands?: string[] } = { skills: ['planning'] },
): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'facet-install-fixture-')))
  const manifest: Record<string, unknown> = { name, version: '0.1.0' }
  if (assets.skills?.length) {
    manifest.skills = Object.fromEntries(assets.skills.map((s) => [s, { description: `${s} skill` }]))
    for (const skill of assets.skills) {
      mkdirSync(join(repo, `skills/${skill}`), { recursive: true })
      writeFileSync(join(repo, `skills/${skill}/SKILL.md`), `# ${skill}\n`)
    }
  }
  if (assets.commands?.length) {
    manifest.commands = Object.fromEntries(assets.commands.map((c) => [c, { description: `${c} command` }]))
    mkdirSync(join(repo, 'commands'), { recursive: true })
    for (const cmd of assets.commands) {
      writeFileSync(join(repo, `commands/${cmd}.md`), `# ${cmd}\n`)
    }
  }
  writeFileSync(join(repo, 'facet.json'), JSON.stringify(manifest))
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.com'], repo)
  git(['config', 'user.name', 'Test'], repo)
  git(['add', '.'], repo)
  git(['commit', '-q', '-m', 'initial'], repo)
  return repo
}

/**
 * Install a minimal fake adapter into the test adapters dir so
 * loadInstalledAdapters() returns it. The adapter is self-contained
 * plain ESM (no external imports) so it loads with zero resolution
 * required — mirroring the shape a bundled @agent-facets/adapter-* ships.
 */
function installFakeAdapter(adaptersBaseDir: string, name: string): void {
  const dir = join(adaptersBaseDir, name)
  mkdirSync(dir, { recursive: true })
  // Use the real asset-fs helpers (imported from the workspace adapter SDK)
  // so frontmatter assembly is exercised end-to-end. Path is absolute so the
  // import resolves regardless of where the bundle is dynamically loaded from.
  const assetFsImport = require.resolve('@agent-facets/adapter')
  const src = `
import { installAssetFile, readAssetFile, deleteAssetFile } from '${assetFsImport}'
import { join } from 'node:path'

function path(type, name) {
  const base = join(process.cwd(), '.${name}')
  return join(base, type + 's', name + '.md')
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
`
  writeFileSync(join(dir, 'adapter.js'), src)
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalAdaptersDir = process.env.FACETS_ADAPTERS_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-install-root-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-install-home-')))
  adaptersDir = realpathSync(mkdtempSync(join(tmpdir(), 'facet-install-adapters-')))
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
  rmSync(adaptersDir, { recursive: true, force: true })
})

describe('facet install — happy path (single facet, single adapter)', () => {
  test('materializes skills into the adapter and writes a lockfile', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning'] })
    try {
      installFakeAdapter(adaptersDir, 'test-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': `git+file://${fixture}#main` } }),
      )

      const code = await installCommand.run([], {})
      expect(code).toBe(0)

      // Asset materialized in the adapter's project-scope path. Skill name
      // is the manifest's asset name — no facet-namespace prefix.
      const skillPath = join(projectRoot, '.test-adapter/skills/planning.md')
      expect(existsSync(skillPath)).toBe(true)
      const raw = readFileSync(skillPath, 'utf8')
      expect(raw).toContain('# planning') // body preserved
      // Front-matter written by asset-fs helper: name + description minimum.
      expect(raw).toContain('name: planning')
      expect(raw).toContain('description: planning skill')

      // Lockfile written
      const lockPath = join(projectRoot, 'facets.lock')
      expect(existsSync(lockPath)).toBe(true)
      const lockfile = JSON.parse(readFileSync(lockPath, 'utf8'))
      expect(lockfile.lockfileVersion).toBe(1)
      expect(lockfile.facets['viper-plans']).toMatchObject({
        source: expect.stringContaining('git+file://'),
        version: '0.1.0',
        assets: [{ scope: 'project', type: 'skill', name: 'planning' }],
      })
      expect(lockfile.facets['viper-plans'].integrity).toMatch(/^sha256:/)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

describe('facet install — drift-proof convergence', () => {
  test('removes assets absent from the new version', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning', 'extras'] })
    try {
      installFakeAdapter(adaptersDir, 'test-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': `git+file://${fixture}#main` } }),
      )

      // First install — both skills present
      await installCommand.run([], {})
      expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)
      expect(existsSync(join(projectRoot, '.test-adapter/skills/extras.md'))).toBe(true)

      // Modify fixture: remove 'extras' skill
      rmSync(join(fixture, 'skills/extras'), { recursive: true, force: true })
      writeFileSync(
        join(fixture, 'facet.json'),
        JSON.stringify({ name: 'viper-plans', version: '0.2.0', skills: { planning: { description: 'plan' } } }),
      )
      git(['add', '.'], fixture)
      git(['commit', '-q', '-m', 'drop extras'], fixture)

      const code = await installCommand.run([], {})
      expect(code).toBe(0)
      const lockfile = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
      expect(lockfile.facets['viper-plans'].version).toBe('0.2.0')
      expect(lockfile.facets['viper-plans'].assets).toHaveLength(1)
      // extras skill removed on convergence
      expect(existsSync(join(projectRoot, '.test-adapter/skills/extras.md'))).toBe(false)
      // planning skill still present
      expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

describe('facet install — --dry-run', () => {
  test('prints a plan, writes no files, and exits 0', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning'] })
    try {
      installFakeAdapter(adaptersDir, 'test-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': `git+file://${fixture}#main` } }),
      )

      const chunks: string[] = []
      const orig = process.stdout.write.bind(process.stdout)
      process.stdout.write = ((c: unknown) => {
        chunks.push(String(c))
        return true
      }) as typeof process.stdout.write
      let code: number
      try {
        code = await installCommand.run([], { 'dry-run': true })
      } finally {
        process.stdout.write = orig
      }
      expect(code).toBe(0)
      const out = chunks.join('')
      expect(out).toContain('Would install viper-plans@0.1.0')
      expect(out).toContain('Dry run — no changes written.')
      // No side effects on disk
      expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(false)
      expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  test('prints "in sync" when lockfile matches the plan', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning'] })
    try {
      installFakeAdapter(adaptersDir, 'test-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': `git+file://${fixture}#main` } }),
      )
      // First: real install to populate the lockfile.
      await installCommand.run([], {})

      // Now: dry-run should detect no changes.
      const chunks: string[] = []
      const orig = process.stdout.write.bind(process.stdout)
      process.stdout.write = ((c: unknown) => {
        chunks.push(String(c))
        return true
      }) as typeof process.stdout.write
      try {
        await installCommand.run([], { 'dry-run': true })
      } finally {
        process.stdout.write = orig
      }
      expect(chunks.join('')).toContain('No changes. facets.lock is in sync with facets.json.')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

describe('facet install — rollback on adapter error', () => {
  test('journal replays inverse ops and nothing stays on disk after adapter.installAsset throws', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning', 'other'] })
    try {
      // Install a "broken" fake adapter that throws on installAsset after the
      // first successful write. It emulates a real-world partial-write
      // failure (permission error mid-materialize).
      const adapterDir = join(adaptersDir, 'broken-adapter')
      mkdirSync(adapterDir, { recursive: true })
      writeFileSync(
        join(adapterDir, 'adapter.js'),
        `
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

let installCount = 0
function path(type, name) { return join(process.cwd(), '.broken-adapter', type + 's', name + '.md') }

export default {
  name: 'broken-adapter',
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(scope, type, name, content, metadata) {
    installCount++
    if (installCount >= 2) throw new Error('boom on second install')
    const p = path(type, name)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, content, 'utf8')
  },
  async readAsset(scope, type, name) {
    // Emulate a real adapter's "file doesn't exist" error shape.
    // F14 narrows to ENOENT — any other code would rethrow and block install.
    const err = new Error('not installed')
    err.code = 'ENOENT'
    throw err
  },
  async deleteAsset(scope, type, name) { await rm(path(type, name), { force: true }) },
}
`,
      )

      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': `git+file://${fixture}#main` } }),
      )

      const code = await installCommand.run([], {})
      expect(code).toBe(1)

      // Both assets rolled back — neither should be on disk. (The first
      // install succeeded, but its inverse delete ran during rollback.)
      expect(existsSync(join(projectRoot, '.broken-adapter/skills/planning.md'))).toBe(false)
      expect(existsSync(join(projectRoot, '.broken-adapter/skills/other.md'))).toBe(false)

      // Lockfile should NOT have been written on failure.
      expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  // F7: the real-world worst case is adapter #2 fails AFTER adapter #1
  // wrote a real asset on disk. The journal must replay the inverse op for
  // adapter #1's write so nothing is left behind.
  test('multi-adapter: adapter #2 failure rolls back adapter #1 writes', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning'] })
    try {
      // adapter-a writes for real via the shared asset-fs helpers.
      installFakeAdapter(adaptersDir, 'adapter-a')
      // adapter-b unconditionally throws on installAsset.
      const brokenDir = join(adaptersDir, 'adapter-b')
      mkdirSync(brokenDir, { recursive: true })
      writeFileSync(
        join(brokenDir, 'adapter.js'),
        `
export default {
  name: 'adapter-b',
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset() { throw new Error('adapter-b boom') },
  async readAsset() { const e = new Error('nope'); e.code = 'ENOENT'; throw e },
  async deleteAsset() {},
}
`,
      )

      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': `git+file://${fixture}#main` } }),
      )

      const code = await installCommand.run([], {})
      expect(code).toBe(1)

      // adapter-a's write must have been rolled back — file should NOT exist.
      expect(existsSync(join(projectRoot, '.adapter-a/skills/planning.md'))).toBe(false)
      // No lockfile on failure.
      expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

describe('facet install — error paths', () => {
  test('exits 1 with error when facets.json is missing', async () => {
    const code = await installCommand.run([], {})
    expect(code).toBe(1)
  })

  test('exits 1 with error when no adapters are installed', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: {} }))
    const code = await installCommand.run([], {})
    expect(code).toBe(1)
  })

  test('exits 1 when facets.json key mismatches the source facet.json name', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning'] })
    try {
      installFakeAdapter(adaptersDir, 'test-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'wrong-key': `git+file://${fixture}#main` } }),
      )
      const code = await installCommand.run([], {})
      expect(code).toBe(1)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  test('exits 1 when source manifest has nested facets (composition)', async () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'facet-composition-')))
    try {
      writeFileSync(
        join(fixture, 'facet.json'),
        JSON.stringify({
          name: 'composed',
          version: '0.1.0',
          skills: { dummy: { description: 'x' } },
          facets: ['other@1.0.0'],
        }),
      )
      mkdirSync(join(fixture, 'skills/dummy'), { recursive: true })
      writeFileSync(join(fixture, 'skills/dummy/SKILL.md'), '# dummy')
      git(['init', '-q', '-b', 'main'], fixture)
      git(['config', 'user.email', 'test@example.com'], fixture)
      git(['config', 'user.name', 'Test'], fixture)
      git(['add', '.'], fixture)
      git(['commit', '-q', '-m', 'initial'], fixture)

      installFakeAdapter(adaptersDir, 'test-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { composed: `git+file://${fixture}#main` } }),
      )

      const code = await installCommand.run([], {})
      expect(code).toBe(1)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  // F7: composition-reject also fires on `servers` field, not only `facets`.
  test('exits 1 when source manifest has servers (composition)', async () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'facet-servers-')))
    try {
      writeFileSync(
        join(fixture, 'facet.json'),
        JSON.stringify({
          name: 'with-servers',
          version: '0.1.0',
          skills: { dummy: { description: 'x' } },
          servers: { jira: '1.0.0' },
        }),
      )
      mkdirSync(join(fixture, 'skills/dummy'), { recursive: true })
      writeFileSync(join(fixture, 'skills/dummy/SKILL.md'), '# dummy')
      git(['init', '-q', '-b', 'main'], fixture)
      git(['config', 'user.email', 'test@example.com'], fixture)
      git(['config', 'user.name', 'Test'], fixture)
      git(['add', '.'], fixture)
      git(['commit', '-q', '-m', 'initial'], fixture)

      installFakeAdapter(adaptersDir, 'test-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'with-servers': `git+file://${fixture}#main` } }),
      )

      const code = await installCommand.run([], {})
      expect(code).toBe(1)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

/**
 * F14: install an adapter whose readAsset throws EACCES (non-ENOENT). The
 * install must abort loud rather than proceed with `previous = null` (which
 * would let a rollback silently delete a pre-existing asset).
 */
function installFaultyReadAdapter(adaptersBaseDir: string, name: string): void {
  const dir = join(adaptersBaseDir, name)
  mkdirSync(dir, { recursive: true })
  const src = `
export default {
  name: '${name}',
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset() { throw new Error('should never be called — readAsset failed first') },
  async readAsset() { const e = new Error('simulated EACCES'); e.code = 'EACCES'; throw e },
  async deleteAsset() {},
}
`
  writeFileSync(join(dir, 'adapter.js'), src)
}

/**
 * F7 — SIGINT mid-install: the installCommand registers a SIGINT handler that
 * sets `interrupted = true` and the post-loop guard throws → rollback. We
 * wire a fake adapter that triggers `process.emit('SIGINT')` from inside
 * installAsset so the signal fires between the per-asset install (which the
 * journal just recorded) and the post-loop interrupted check.
 */
function installSigintTriggerAdapter(adaptersBaseDir: string, name: string): void {
  const dir = join(adaptersBaseDir, name)
  mkdirSync(dir, { recursive: true })
  const src = `
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

function path(type, asset) {
  return join(process.cwd(), '.${name}', type + 's', asset + '.md')
}

export default {
  name: '${name}',
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(scope, type, name, content) {
    const p = path(type, name)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, content, 'utf8')
    // Fire SIGINT after the first asset — the post-loop guard inside
    // installCommand.run should observe interrupted=true and throw.
    process.emit('SIGINT')
  },
  async readAsset() { const e = new Error('nope'); e.code = 'ENOENT'; throw e },
  async deleteAsset(scope, type, asset) { await rm(path(type, asset), { force: true }) },
}
`
  writeFileSync(join(dir, 'adapter.js'), src)
}

describe('facet install — SIGINT handling', () => {
  test('SIGINT during install triggers rollback and exits 1', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning'] })
    try {
      installSigintTriggerAdapter(adaptersDir, 'sigint-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': `git+file://${fixture}#main` } }),
      )

      const code = await installCommand.run([], {})
      expect(code).toBe(1)
      // Asset that was written during installAsset must have been rolled back.
      expect(existsSync(join(projectRoot, '.sigint-adapter/skills/planning.md'))).toBe(false)
      // Lockfile never written.
      expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

describe('facet install — F14 rollback safety', () => {
  test('non-ENOENT read error aborts install before any journal record', async () => {
    const fixture = buildFixtureRepo('viper-plans', { skills: ['planning'] })
    try {
      installFaultyReadAdapter(adaptersDir, 'faulty-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': `git+file://${fixture}#main` } }),
      )

      const code = await installCommand.run([], {})
      expect(code).toBe(1)

      // Lockfile must NOT have been written; no asset should exist on disk.
      expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
      expect(existsSync(join(projectRoot, '.faulty-adapter/skills/planning.md'))).toBe(false)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

describe('facet install — metadata integrity', () => {
  // F2: adapter extras must NOT override computed name/description in the
  // materialized frontmatter. Spread order in buildAssetMetadata is
  // extras-first, name/description last.
  test('adapter-extras cannot override computed name or description', async () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'facet-override-')))
    try {
      writeFileSync(
        join(fixture, 'facet.json'),
        JSON.stringify({
          name: 'override-test',
          version: '0.1.0',
          skills: {
            planning: {
              description: 'real description',
              adapters: {
                'test-adapter': {
                  name: 'PWNED',
                  description: 'also pwned',
                  // harmless extra — must survive
                  tools: { grep: true },
                },
              },
            },
          },
        }),
      )
      mkdirSync(join(fixture, 'skills/planning'), { recursive: true })
      writeFileSync(join(fixture, 'skills/planning/SKILL.md'), '# planning\n')
      git(['init', '-q', '-b', 'main'], fixture)
      git(['config', 'user.email', 'test@example.com'], fixture)
      git(['config', 'user.name', 'Test'], fixture)
      git(['add', '.'], fixture)
      git(['commit', '-q', '-m', 'initial'], fixture)

      installFakeAdapter(adaptersDir, 'test-adapter')
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'override-test': `git+file://${fixture}#main` } }),
      )

      const code = await installCommand.run([], {})
      expect(code).toBe(0)

      const raw = readFileSync(join(projectRoot, '.test-adapter/skills/planning.md'), 'utf8')
      expect(raw).toContain('name: planning')
      expect(raw).toContain('description: real description')
      expect(raw).not.toContain('PWNED')
      expect(raw).not.toContain('also pwned')
      // Adapter extras that don't collide with name/description still make it through.
      expect(raw).toContain('grep: true')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
