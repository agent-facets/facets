import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { compileTarget } from './build'
import { allTargets, buildTargetPackageJson, bunTarget, packageName, shouldSmokeTest } from './targets'

const engineManifest = resolve(import.meta.dir, '../../packages/engine/package.json')
const fromEngine = createRequire(engineManifest)
const koffiEntry = fromEngine.resolve('koffi')
const koffiManifest = await Bun.file(join(dirname(koffiEntry), 'package.json')).json()
const optional: string[] = Object.keys(koffiManifest.optionalDependencies)
const helper = resolve(import.meta.dir, '../../packages/engine/src/registry/oauth-permissions.ts')

// A plain `bun install` only fetches the host's koffi prebuild. The Darwin ones
// arrive via `bun install --os '*' --cpu '*'`, which CI runs before `bun check`.
const darwinArches = [...new Set(allTargets.filter((target) => target.os === 'darwin').map((target) => target.arch))]
const darwinPrebuildsInstalled = darwinArches.every((arch) => {
  try {
    createRequire(koffiEntry).resolve(`@koromix/koffi-darwin-${arch}`)
    return true
  } catch {
    return false
  }
})
const requireNativeGraph = darwinPrebuildsInstalled || Boolean(process.env.CI)

/** An engine manifest whose koffi mirrors the real one, with stub Darwin prebuilds. */
async function writeEngineFixture(root: string): Promise<string> {
  const engine = join(root, 'engine', 'package.json')
  const modules = join(root, 'engine', 'node_modules')
  await mkdir(join(modules, 'koffi'), { recursive: true })
  await writeFile(engine, '{}')
  await writeFile(join(modules, 'koffi', 'index.cjs'), '')
  await writeFile(
    join(modules, 'koffi', 'package.json'),
    JSON.stringify({
      name: 'koffi',
      version: koffiManifest.version,
      main: 'index.cjs',
      optionalDependencies: koffiManifest.optionalDependencies,
    }),
  )
  for (const arch of darwinArches) {
    const name = `@koromix/koffi-darwin-${arch}`
    const dir = join(modules, name)
    await mkdir(join(dir, `darwin_${arch}`), { recursive: true })
    await writeFile(join(dir, 'index.js'), '')
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name, version: koffiManifest.version, main: 'index.js' }),
    )
    await writeFile(join(dir, `darwin_${arch}`, 'koffi.node'), 'fixture')
  }
  return engine
}

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'cli-native-build-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const successful: Bun.BuildOutput = { success: true, outputs: [], logs: [] }

test('build import is safe and never starts compilation', () => {
  const script = `Bun.build = () => { throw Error('unexpected build') }; await import(${JSON.stringify(new URL('./build.ts', import.meta.url).pathname)}); console.log('import-safe')`
  const child = Bun.spawnSync([process.execPath, '-e', script], { timeout: 5_000, stdout: 'pipe', stderr: 'pipe' })
  expect(child.exitCode).toBe(0)
  expect(child.stdout.toString().trim()).toBe('import-safe')
  expect(child.stderr.toString()).toBe('')
})

test.each(allTargets)('actual target receiver preserves $os/$arch/$abi/$avx2 options', async (target) => {
  const received: Bun.BuildConfig[] = []
  let result: Awaited<ReturnType<typeof compileTarget>> | undefined
  await fixture(async (root) => {
    const enginePackageJson = await writeEngineFixture(root)
    result = await compileTarget(
      target,
      { entrypoint: '/entry.ts', outfile: '/binary', enginePackageJson },
      async (options) => {
        received.push(options)
        return successful
      },
    )
  })
  if (!result?.ok) expect.unreachable()
  expect(received).toHaveLength(1)
  const selected = target.os === 'darwin' ? `@koromix/koffi-darwin-${target.arch}` : undefined
  expect(received[0]).toEqual({
    entrypoints: ['/entry.ts'],
    define: { 'process.platform': JSON.stringify(target.os), 'process.arch': JSON.stringify(target.arch) },
    external: optional.filter((name) => name !== selected),
    minify: { syntax: true },
    compile: {
      target: bunTarget(packageName(target)),
      outfile: '/binary',
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
    },
  })
  expect(buildTargetPackageJson(packageName(target), 'test-version', target)).toEqual({
    name: packageName(target),
    version: 'test-version',
    os: [target.os],
    cpu: [target.arch],
  })
})

test.each([
  'missing-package',
  'mismatch',
  'missing-native',
  'main-mismatch',
] as const)('preflight %s stops before the actual receiver', async (scenario) => {
  await fixture(async (root) => {
    const engine = join(root, 'engine', 'package.json')
    const modules = join(root, 'engine', 'node_modules')
    const main = join(modules, 'koffi')
    const selected = join(modules, '@koromix', 'koffi-darwin-arm64')
    await mkdir(main, { recursive: true })
    await writeFile(engine, '{}')
    await writeFile(join(main, 'index.cjs'), '')
    await writeFile(
      join(main, 'package.json'),
      JSON.stringify({
        name: 'koffi',
        version: scenario === 'main-mismatch' ? '0.0.0' : '3.3.2',
        main: 'index.cjs',
        optionalDependencies: { '@koromix/koffi-darwin-arm64': '3.3.2' },
      }),
    )
    if (scenario !== 'missing-package') {
      await mkdir(join(selected, 'darwin_arm64'), { recursive: true })
      await writeFile(join(selected, 'index.js'), '')
      await writeFile(
        join(selected, 'package.json'),
        JSON.stringify({
          name: '@koromix/koffi-darwin-arm64',
          version: scenario === 'mismatch' ? '0.0.0' : '3.3.2',
          main: 'index.js',
        }),
      )
      if (scenario !== 'missing-native') await writeFile(join(selected, 'darwin_arm64', 'koffi.node'), 'fixture')
    }
    let invoked = 0
    const result = await compileTarget(
      { os: 'darwin', arch: 'arm64' },
      {
        entrypoint: '/unused.ts',
        outfile: join(root, 'unused'),
        enginePackageJson: engine,
      },
      async () => {
        invoked++
        return successful
      },
    )
    if (result.ok) expect.unreachable()
    expect(result.code).toBe(scenario.includes('mismatch') ? 'native-package-mismatch' : 'native-package-unavailable')
    expect(invoked).toBe(0)
    expect(await Bun.file(join(root, 'unused')).exists()).toBe(false)
  })
})

// Allow twelve sequential 30-second builds plus 30 seconds for fixture setup and cleanup.
// Needs the real Darwin prebuilds; skipped locally without them, but mandatory in CI.
test.skipIf(!requireNativeGraph)(
  'production options select the real native graph for all twelve targets',
  async () => {
    await fixture(async (root) => {
      const entry = join(root, 'graph.ts')
      await writeFile(
        entry,
        `import { inspectDarwinDirectoryAcl } from ${JSON.stringify(helper)}; console.log(inspectDarwinDirectoryAcl(Number(process.env.TEST_FD)))`,
      )
      const driver = join(root, 'graph-driver.ts')
      await writeFile(
        driver,
        `
      import assert from 'node:assert/strict'
      import { createHash } from 'node:crypto'
      import { readFileSync } from 'node:fs'
      import { createRequire } from 'node:module'
      import { dirname, join } from 'node:path'
      import { compileTarget } from ${JSON.stringify(new URL('./build.ts', import.meta.url).pathname)}
      const fromEngine = createRequire(${JSON.stringify(engineManifest)})
      const fromKoffi = createRequire(fromEngine.resolve('koffi'))
      const target = JSON.parse(process.argv[2])
      const result = await compileTarget(target, ${JSON.stringify({ entrypoint: entry, outfile: join(root, 'unused') })}, options => Bun.build({...options, compile:undefined, target:'bun'}))
      assert.equal(result.ok,true)
      assert.equal(result.output.success,true)
      const native = result.output.outputs.filter(output => output.path.endsWith('.node'))
      if(target.os === 'darwin') {
        assert.equal(native.length,1)
        const selected = join(dirname(fromKoffi.resolve('@koromix/koffi-darwin-'+target.arch)), 'darwin_'+target.arch, 'koffi.node')
        assert.equal(createHash('sha256').update(new Uint8Array(await native[0].arrayBuffer())).digest('hex'),createHash('sha256').update(readFileSync(selected)).digest('hex'))
      } else assert.equal(native.length,0)
      console.log('verified graph '+target.os+' '+target.arch)
    `,
      )
      for (const target of allTargets) {
        const child = Bun.spawnSync([process.execPath, driver, JSON.stringify(target)], {
          timeout: 30_000,
          stdout: 'pipe',
          stderr: 'pipe',
        })
        expect({ exit: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() }).toEqual({
          exit: 0,
          stdout: expect.stringContaining(`verified graph ${target.os} ${target.arch}`),
          stderr: expect.any(String),
        })
      }
    })
  },
  390_000,
)

const policy = `
import assert from 'node:assert/strict'
import { constants, closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectDarwinDirectoryAcl } from ${JSON.stringify(helper)}
const root = mkdtempSync(join(tmpdir(), 'cli-native-policy-'))
function chmod(...args) {
 const child = Bun.spawnSync(['/bin/chmod', ...args], {timeout:5000})
 assert.equal(child.exitCode,0,child.stderr.toString())
}
try {
 for (const [name, acl, expected] of [
  ['absent',null,{ok:true}], ['deny','everyone deny delete',{ok:true}],
  ['allow','everyone allow delete,delete_child',{ok:false,reason:'unsafe-acl'}],
 ]) {
  const path = join(root,name)
  mkdirSync(path,{mode:0o700}); chmod('-N',path)
  if (acl) chmod('+a',acl,path)
  const fd = openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
  try { for(let i=0;i<100;i++){assert.deepEqual(inspectDarwinDirectoryAcl(fd),expected); Bun.gc(true)};assert.equal(fstatSync(fd).isDirectory(),true) }
  finally { closeSync(fd) }
 }
 assert.deepEqual(inspectDarwinDirectoryAcl(-1),{ok:false,reason:'acl-unavailable'})
 console.log('verified policy '+process.arch+' Bun '+Bun.version)
} finally { chmod('-RN',root); rmSync(root,{recursive:true,force:true}) }
`

describe('standalone production native policy', () => {
  test.skipIf(process.platform !== 'darwin')(
    'compiles isolated arm64/x64-baseline and retains ACL policy through forced GC in source and the host binary',
    async () => {
      await fixture(async (root) => {
        const script = join(root, 'policy.ts')
        const isolated = join(root, 'isolated')
        await mkdir(isolated)
        await writeFile(script, policy)
        const source = Bun.spawnSync([process.execPath, script], {
          cwd: isolated,
          timeout: 60_000,
          stdout: 'pipe',
          stderr: 'pipe',
        })
        expect({ exit: source.exitCode, stdout: source.stdout.toString() }).toEqual({
          exit: 0,
          stdout: expect.stringContaining('verified policy'),
        })
        for (const target of allTargets.filter(
          (item) => item.os === 'darwin' && (item.arch === 'arm64' || item.avx2 === false),
        )) {
          const binary = join(isolated, packageName(target).split('/')[1] ?? 'policy')
          const driver = join(root, 'compile.ts')
          await writeFile(
            driver,
            `
          import { compileTarget } from ${JSON.stringify(new URL('./build.ts', import.meta.url).pathname)}
          const result = await compileTarget(${JSON.stringify(target)}, ${JSON.stringify({ entrypoint: script, outfile: binary })})
          if (!result.ok || !result.output.success) { console.error(result); process.exit(1) }
          console.log('compiled production receiver')
        `,
          )
          const built = Bun.spawnSync([process.execPath, driver], {
            cwd: isolated,
            timeout: 60_000,
            stdout: 'pipe',
            stderr: 'pipe',
          })
          expect({ exit: built.exitCode, stdout: built.stdout.toString(), stderr: built.stderr.toString() }).toEqual({
            exit: 0,
            stdout: expect.stringContaining('compiled production receiver'),
            stderr: expect.any(String),
          })
          if (shouldSmokeTest(target, process.platform, process.arch)) {
            const child = Bun.spawnSync([binary], { cwd: isolated, timeout: 60_000, stdout: 'pipe', stderr: 'pipe' })
            expect({ exit: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() }).toEqual({
              exit: 0,
              stdout: expect.stringContaining(`verified policy ${target.arch} Bun ${Bun.version}`),
              stderr: expect.any(String),
            })
          }
        }
      })
    },
    120_000,
  )
})
