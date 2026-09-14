/** Package already-built CLI binaries independently of npm publishing. */
import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { $ } from 'bun'
import {
  allTargets,
  binaryPath,
  executableName,
  filterTargets,
  releaseArchiveName,
  releaseAssetsDir,
  releaseAssetTargets,
} from './targets'

export type PackageAssetsResult =
  | { ok: true; archives: string[]; checksumsPath: string }
  | { ok: false; code: 'missing-target-value' }
  | { ok: false; code: 'no-matching-targets' }
  | { ok: false; code: 'missing-binary'; binary: string }
  | { ok: false; code: 'package-failed'; archive: string }

export interface PackageAssetsOptions {
  cliDir: string
  argv: string[]
  platform: string
  arch: string
}

export async function packageAssets(opts: PackageAssetsOptions): Promise<PackageAssetsResult> {
  const targetIndex = opts.argv.indexOf('--target')
  const target = targetIndex !== -1 ? opts.argv[targetIndex + 1] : undefined
  if (targetIndex !== -1 && (!target || target.startsWith('-'))) {
    return { ok: false, code: 'missing-target-value' }
  }

  const targets = releaseAssetTargets(
    filterTargets(allTargets, {
      single: opts.argv.includes('--single'),
      target,
      platform: opts.platform,
      arch: opts.arch,
    }),
  )
  if (targets.length === 0) {
    return { ok: false, code: 'no-matching-targets' }
  }

  // Only this job owns release-assets; npm build/publish never touches it.
  const assetsDir = releaseAssetsDir(opts.cliDir)
  await rm(assetsDir, { recursive: true, force: true })
  await mkdir(assetsDir, { recursive: true })

  const archives: string[] = []
  const checksums: string[] = []
  for (const target of targets) {
    const name = releaseArchiveName(target)
    const archive = resolve(assetsDir, name)
    const binary = binaryPath(opts.cliDir, target)
    if (!(await Bun.file(binary).exists())) {
      return { ok: false, code: 'missing-binary', binary }
    }
    const binDir = dirname(binary)
    const executable = executableName(target)
    const result =
      target.os === 'win32'
        ? await $`zip -j ${archive} ${executable}`.cwd(binDir).nothrow()
        : await $`tar -czf ${archive} -C ${binDir} ${executable}`.nothrow()
    if (result.exitCode !== 0) {
      return { ok: false, code: 'package-failed', archive: name }
    }
    const hash = createHash('sha256')
      .update(await Bun.file(archive).bytes())
      .digest('hex')
    checksums.push(`${hash}  ${name}`)
    archives.push(name)
    console.log(`  ✓ ${name}`)
  }
  const checksumsPath = resolve(assetsDir, 'checksums.txt')
  await Bun.write(checksumsPath, `${checksums.sort().join('\n')}\n`)
  return { ok: true, archives, checksumsPath }
}

if (import.meta.main) {
  const result = await packageAssets({
    cliDir: resolve(import.meta.dir, '..', '..', 'packages', 'cli'),
    argv: process.argv.slice(2),
    platform: process.platform,
    arch: process.arch,
  })
  if (!result.ok) {
    switch (result.code) {
      case 'missing-target-value':
        console.error('--target requires a value')
        break
      case 'no-matching-targets':
        console.error('No matching release asset targets')
        break
      case 'missing-binary':
        console.error(`Missing binary: ${result.binary}. Build the selected baseline/ARM64 target first.`)
        break
      case 'package-failed':
        console.error(`Failed to package ${result.archive}`)
        break
    }
    process.exit(1)
  }
}
