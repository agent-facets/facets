#!/usr/bin/env bun

/**
 * Synthesize and publish the CLI package (agent-facets) to npm.
 *
 * Discovers platform packages from build output, generates the CLI
 * package.json with optionalDependencies pointing to all 12 platform
 * packages, then packs and publishes with --tag latest.
 *
 * Idempotent — skips if the version is already published.
 *
 * Usage: bun scripts/release-cli/publish-cli-package.ts
 */

import path from 'node:path'
import { $ } from 'bun'
import { CLI_DIR, CLI_PACKAGE_NAME, DIST_DIR, PUBLISH_TAG } from '../lib/constants'
import { io } from '../lib/io'
import { mintNpmToken, versionExists } from '../lib/npm'

/** Discover platform packages from build output. */
async function discoverPlatformPackages(): Promise<Record<string, string>> {
  const binaries: Record<string, string> = {}
  for await (const filepath of new Bun.Glob('@*/*/package.json').scanSync({ cwd: DIST_DIR })) {
    const pkg = await io.shell.readJson(path.join(DIST_DIR, filepath))
    binaries[pkg.name] = pkg.version
  }
  return binaries
}

export async function publishCliPackage(): Promise<number> {
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

  console.log(`Synthesizing ${CLI_PACKAGE_NAME}@${version}...`)

  if (await versionExists(CLI_PACKAGE_NAME, version)) {
    console.log(`~ ${CLI_PACKAGE_NAME}@${version} already published, skipping`)
    return 0
  }

  const cliPkgDir = path.join(DIST_DIR, CLI_PACKAGE_NAME)

  await $`mkdir -p ${cliPkgDir}/bin`
  await $`cp ${path.join(CLI_DIR, 'bin', 'facet')} ${cliPkgDir}/bin/facet`
  await $`cp ${path.join(CLI_DIR, 'bin', 'package.json')} ${cliPkgDir}/bin/package.json`
  await $`cp ${path.join(CLI_DIR, 'scripts', 'postinstall.mjs')} ${cliPkgDir}/postinstall.mjs`

  await io.shell.writeFile(
    path.join(cliPkgDir, 'package.json'),
    JSON.stringify(
      {
        name: CLI_PACKAGE_NAME,
        version,
        bin: { facet: './bin/facet' },
        scripts: { postinstall: 'node ./postinstall.mjs' },
        optionalDependencies: binaries,
      },
      null,
      2,
    ),
  )

  await io.shell.pack(cliPkgDir)
  await io.npm.publishTarball(cliPkgDir, PUBLISH_TAG)

  console.log(`+ ${CLI_PACKAGE_NAME}@${version} published (latest)`)
  return 0
}

if (import.meta.main) {
  const code = await publishCliPackage()
  process.exit(code)
}
