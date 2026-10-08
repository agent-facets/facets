/** Cross-compile the CLI for all 12 targets, --single [--baseline], or --target <name>. */
import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import {
  allTargets,
  buildTargetPackageJson,
  bunTarget,
  filterTargets,
  outfilePath,
  packageJsonPath,
  packageName,
  shouldSmokeTest,
  type Target,
} from './targets'

const cliDir = resolve(import.meta.dir, '..', '..', 'packages', 'cli')
const enginePackageJson = resolve(cliDir, '..', 'engine', 'package.json')
const KOFFI_VERSION = '3.3.2'

type NativeFailure = { ok: false; code: 'native-package-unavailable' | 'native-package-mismatch'; package: string }
export type CompileResult = { ok: true; output: Bun.BuildOutput } | NativeFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function nativeOptions(
  target: Target,
  engineManifest: string,
): Promise<{ ok: true; external: string[] } | NativeFailure> {
  let selected = 'koffi'
  try {
    const fromEngine = createRequire(engineManifest)
    const entry = fromEngine.resolve('koffi')
    const manifest: unknown = JSON.parse(await readFile(join(dirname(entry), 'package.json'), 'utf8'))
    if (!isRecord(manifest) || manifest.version !== KOFFI_VERSION || !isRecord(manifest.optionalDependencies)) {
      return { ok: false, code: 'native-package-mismatch', package: selected }
    }
    const optional = Object.entries(manifest.optionalDependencies)
    if (
      optional.length === 0 ||
      optional.some(([name, version]) => !name.startsWith('@koromix/koffi-') || version !== KOFFI_VERSION)
    ) {
      return { ok: false, code: 'native-package-mismatch', package: selected }
    }
    if (target.os === 'darwin') {
      selected = `@koromix/koffi-darwin-${target.arch}`
      if (!(selected in manifest.optionalDependencies)) {
        return { ok: false, code: 'native-package-mismatch', package: selected }
      }
      const nativeEntry = createRequire(entry).resolve(selected)
      const metadata: unknown = JSON.parse(await readFile(join(dirname(nativeEntry), 'package.json'), 'utf8'))
      if (!isRecord(metadata) || metadata.version !== KOFFI_VERSION) {
        return { ok: false, code: 'native-package-mismatch', package: selected }
      }
      const addon = join(dirname(nativeEntry), `darwin_${target.arch}`, 'koffi.node')
      await access(nativeEntry, constants.R_OK)
      await access(addon, constants.R_OK)
      if (!(await stat(addon)).isFile()) return { ok: false, code: 'native-package-unavailable', package: selected }
    }
    return { ok: true, external: optional.map(([name]) => name).filter((name) => name !== selected) }
  } catch {
    return { ok: false, code: 'native-package-unavailable', package: selected }
  }
}

/** The release loop and native smoke fixtures use this same checked build receiver. */
export async function compileTarget(
  target: Target,
  paths: { entrypoint: string; outfile: string; enginePackageJson?: string },
  build: typeof Bun.build = (options) => Bun.build(options),
): Promise<CompileResult> {
  const native = await nativeOptions(target, paths.enginePackageJson ?? enginePackageJson)
  if (!native.ok) return native
  const output = await build({
    entrypoints: [paths.entrypoint],
    define: { 'process.platform': JSON.stringify(target.os), 'process.arch': JSON.stringify(target.arch) },
    external: native.external,
    minify: { syntax: true },
    compile: {
      target: bunTarget(packageName(target)),
      outfile: paths.outfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
    },
  })
  return { ok: true, output }
}

async function main(): Promise<number> {
  const pkg = await Bun.file(resolve(cliDir, 'package.json')).json()
  const version: string = pkg.version
  const targetIndex = process.argv.indexOf('--target')
  const targets = filterTargets(allTargets, {
    single: process.argv.includes('--single'),
    baseline: process.argv.includes('--baseline'),
    target: targetIndex !== -1 ? process.argv[targetIndex + 1] : undefined,
    platform: process.platform,
    arch: process.arch,
  })
  if (targets.length === 0) {
    console.error(`No matching targets for ${process.platform}/${process.arch}`)
    return 1
  }
  console.log(`Building ${targets.length} target(s) — version ${version}\n`)
  for (const target of targets) {
    const name = packageName(target)
    const outfile = outfilePath(cliDir, name)
    console.log(`  Building ${name} (${bunTarget(name)})...`)
    const result = await compileTarget(target, { entrypoint: resolve(cliDir, 'src', 'index.ts'), outfile })
    if (!result.ok) {
      console.error(`  Native preflight failed for ${result.package}: ${result.code}`)
      return 1
    }
    if (!result.output.success) {
      console.error(`  Build failed for ${name}:`)
      for (const log of result.output.logs) console.error(`    ${log}`)
      return 1
    }
    await Bun.file(packageJsonPath(cliDir, name)).write(
      `${JSON.stringify(buildTargetPackageJson(name, version, target), null, 2)}\n`,
    )
    console.log(`  ✓ ${name}`)
    if (shouldSmokeTest(target, process.platform, process.arch)) {
      console.log(`  Running smoke test: ${outfile} --version`)
      const child = Bun.spawn([outfile, '--version'], { stdout: 'pipe', stderr: 'pipe' })
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      if (exit !== 0) {
        console.error(`  ✗ Smoke test failed for ${name}: ${stderr}`)
        return 1
      }
      console.log(`  ✓ Smoke test passed: ${stdout.trim()}`)
    }
  }
  console.log(`\nDone — ${targets.length} target(s) built.`)
  return 0
}

if (import.meta.main) process.exit(await main())
