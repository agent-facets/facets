import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { $ } from 'bun'
import { packageAssets } from './package-assets'
import {
  allTargets,
  binaryPath,
  executableName,
  releaseArchiveName,
  releaseAssetsDir,
  releaseAssetTargets,
} from './targets'

async function withCliFixture<T>(run: (cliDir: string) => Promise<T>): Promise<T> {
  const cliDir = await mkdtemp(join(tmpdir(), 'facets-release-assets-'))
  try {
    return await run(cliDir)
  } finally {
    await rm(cliDir, { recursive: true, force: true })
  }
}

test('rejects --target without a non-flag value', async () => {
  await withCliFixture(async (cliDir) => {
    await expect(
      packageAssets({ cliDir, argv: ['--target', '--single'], platform: 'darwin', arch: 'arm64' }),
    ).resolves.toEqual({ ok: false, code: 'missing-target-value' })
    expect(await Bun.file(releaseAssetsDir(cliDir)).exists()).toBe(false)
  })
})

test('packages release archives with root executables and checksums', async () => {
  await withCliFixture(async (cliDir) => {
    const targets = releaseAssetTargets(allTargets)
    for (const target of targets) {
      const binary = binaryPath(cliDir, target)
      await mkdir(dirname(binary), { recursive: true })
      await Bun.write(binary, `#!/bin/sh\necho ${executableName(target)}\n`)
      await chmod(binary, 0o755)
    }

    const result = await packageAssets({ cliDir, argv: [], platform: 'darwin', arch: 'arm64' })
    if (!result.ok) expect.unreachable()

    const assetsDir = releaseAssetsDir(cliDir)
    expect(result.archives.sort()).toEqual(targets.map(releaseArchiveName).sort())

    for (const target of targets) {
      const archive = join(assetsDir, releaseArchiveName(target))
      if (target.os === 'win32') {
        const listing = await $`unzip -Z1 ${archive}`.text()
        expect(listing.trim()).toBe('facet.exe')
      } else {
        const listing = await $`tar -tzf ${archive}`.text()
        expect(listing.trim()).toBe('facet')
        const details = await $`tar -tvzf ${archive}`.text()
        expect(details).toStartWith('-rwx')
      }
    }

    const checksumLines = (await Bun.file(result.checksumsPath).text()).trim().split('\n')
    expect(checksumLines).toHaveLength(8)
    for (const archiveName of result.archives) {
      const hash = createHash('sha256')
        .update(await Bun.file(join(assetsDir, archiveName)).bytes())
        .digest('hex')
      expect(checksumLines).toContain(`${hash}  ${archiveName}`)
    }
  })
})
