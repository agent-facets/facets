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

const cliDir = resolve(import.meta.dir, '..', '..', 'packages', 'cli')
const targetIndex = process.argv.indexOf('--target')
const targets = releaseAssetTargets(
  filterTargets(allTargets, {
    single: process.argv.includes('--single'),
    target: targetIndex !== -1 ? process.argv[targetIndex + 1] : undefined,
    platform: process.platform,
    arch: process.arch,
  }),
)
if (targets.length === 0) {
  console.error('No matching release asset targets')
  process.exit(1)
}

// Only this job owns release-assets; npm build/publish never touches it.
const assetsDir = releaseAssetsDir(cliDir)
await rm(assetsDir, { recursive: true, force: true })
await mkdir(assetsDir, { recursive: true })

const checksums: string[] = []
for (const target of targets) {
  const name = releaseArchiveName(target)
  const archive = resolve(assetsDir, name)
  const binary = binaryPath(cliDir, target)
  if (!(await Bun.file(binary).exists())) {
    console.error(`Missing binary: ${binary}. Build the selected baseline/ARM64 target first.`)
    process.exit(1)
  }
  const binDir = dirname(binary)
  const executable = executableName(target)
  const result =
    target.os === 'win32'
      ? await $`zip -j ${archive} ${executable}`.cwd(binDir).nothrow()
      : await $`tar -czf ${archive} -C ${binDir} ${executable}`.nothrow()
  if (result.exitCode !== 0) {
    console.error(`Failed to package ${name}`)
    process.exit(1)
  }
  const hash = createHash('sha256')
    .update(await Bun.file(archive).bytes())
    .digest('hex')
  checksums.push(`${hash}  ${name}`)
  console.log(`  ✓ ${name}`)
}
await Bun.write(resolve(assetsDir, 'checksums.txt'), `${checksums.sort().join('\n')}\n`)
