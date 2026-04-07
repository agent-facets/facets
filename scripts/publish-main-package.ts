#!/usr/bin/env bun

/**
 * Synthesize and publish the main package (agent-facets) to npm staging.
 *
 * Discovers platform packages from build output, generates the main
 * package.json with optionalDependencies pointing to all 12 platform
 * packages, then packs and publishes with --tag staging.
 *
 * Idempotent — skips if the version is already published.
 *
 * Usage: bun scripts/publish-main-package.ts
 */

import path from 'node:path'
import { $ } from 'bun'
import { CLI_DIR, DIST_DIR, MAIN_PACKAGE_NAME, STAGING_TAG } from './lib/constants'
import { io } from './lib/io'
import { mintNpmToken, versionExists } from './lib/npm'

/** Discover platform packages from build output. */
async function discoverPlatformPackages(): Promise<Record<string, string>> {
  const binaries: Record<string, string> = {}
  for await (const filepath of new Bun.Glob('@*/*/package.json').scanSync({ cwd: DIST_DIR })) {
    const pkg = await io.readJson(path.join(DIST_DIR, filepath))
    binaries[pkg.name] = pkg.version
  }
  return binaries
}

export async function publishMainPackage(): Promise<number> {
  // Mint OIDC token for npm trusted publishing
  await mintNpmToken()

  const binaries = await discoverPlatformPackages()
  if (Object.keys(binaries).length === 0) {
    console.error('No platform packages found in dist/. Did the build job run?')
    return 1
  }

  const version = Object.values(binaries)[0]
  if (!version) {
    console.error('Could not determine version from platform packages.')
    return 1
  }

  console.log(`Synthesizing ${MAIN_PACKAGE_NAME}@${version}...`)

  if (await versionExists(MAIN_PACKAGE_NAME, version)) {
    console.log(`~ ${MAIN_PACKAGE_NAME}@${version} already published, skipping`)
    return 0
  }

  const mainPkgDir = path.join(DIST_DIR, MAIN_PACKAGE_NAME)

  await $`mkdir -p ${mainPkgDir}/bin`
  await $`cp ${path.join(CLI_DIR, 'bin', 'facet')} ${mainPkgDir}/bin/facet`
  await $`cp ${path.join(CLI_DIR, 'bin', 'package.json')} ${mainPkgDir}/bin/package.json`
  await $`cp ${path.join(CLI_DIR, 'scripts', 'postinstall.mjs')} ${mainPkgDir}/postinstall.mjs`

  await io.writeFile(
    path.join(mainPkgDir, 'package.json'),
    JSON.stringify(
      {
        name: MAIN_PACKAGE_NAME,
        version,
        bin: { facet: './bin/facet' },
        scripts: { postinstall: 'node ./postinstall.mjs' },
        optionalDependencies: binaries,
      },
      null,
      2,
    ),
  )

  await io.pack(mainPkgDir)
  await io.publish(mainPkgDir, STAGING_TAG)

  console.log(`+ ${MAIN_PACKAGE_NAME}@${version} published (staging)`)
  return 0
}

if (import.meta.main) {
  const code = await publishMainPackage()
  process.exit(code)
}
