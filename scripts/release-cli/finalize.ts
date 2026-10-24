#!/usr/bin/env bun

/**
 * Finalize a CLI release — wait for platforms, publish cli package, and wait.
 *
 * Runs after npm has accepted all 12 platform packages from the matrix
 * publish jobs. Acceptance is not availability: npm scans each version before
 * serving it. This script:
 *
 * 1. Waits until all 12 platform packages are available on npm
 * 2. Publishes the cli package (agent-facets) directly to latest
 * 3. Waits until the cli package is available on npm
 *
 * Safety: the cli package is always the last package published, and only
 * once every platform package it depends on is available. If a wait times
 * out, the script exits nonzero before publishing anything further.
 * further. Rerunning the job is safe: the wrapper publish skips a version
 * that already exists.
 *
 * Invoked by the `finalize-cli` job in the release-cli CircleCI workflow.
 */

import { CLI_PACKAGE_NAME } from '../lib/constants'
import { io } from '../lib/io'
import { parseTag } from '../lib/tags'
import { platformPackageNames } from './targets'

export async function finalize(): Promise<number> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) {
    io.console.error('CIRCLE_TAG not set.')
    return 1
  }

  const parsed = parseTag(tag)
  if (!parsed) {
    io.console.error(`Could not parse tag: ${tag}`)
    return 1
  }

  io.console.log(`Finalizing release for ${parsed.name}@${parsed.version}`)

  // Wait for the 12 platform packages to be available on npm before publishing the CLI wrapper.
  // The CLI package's optionalDependencies must be resolvable when users install it.
  io.console.log('Waiting for platform packages to become available on npm...')
  const platforms = await io.shell.verifyPackages(platformPackageNames(), parsed.version)
  if (platforms.exitCode !== 0) {
    io.console.error(
      `Platform packages for ${parsed.version} are not all available on npm. ` +
        `${CLI_PACKAGE_NAME} was NOT published.\n` +
        'Do not republish the platform packages. Once npm makes them available, rerun this job.',
    )
    return 1
  }

  // Publish CLI package to latest (synthesizes from build output, mints its own OIDC token).
  // The wrapper is always the LAST package published — users cannot install the new version
  // until this completes successfully.
  io.console.log('Publishing CLI package...')
  await io.shell.publishCliPackage()

  // Wait for the CLI wrapper itself to be available before asset delivery publishes the release.
  io.console.log('Waiting for CLI package to become available on npm...')
  const wrapper = await io.shell.verifyPackages([CLI_PACKAGE_NAME], parsed.version)
  if (wrapper.exitCode !== 0) {
    io.console.error(
      `${CLI_PACKAGE_NAME}@${parsed.version} was published but is not available on npm yet; ` +
        'the GitHub Release was not published.\n' +
        'Do not republish. Once npm makes it available, rerun this job: it skips the existing publish.',
    )
    return 1
  }

  io.console.log(`Published ${parsed.name}@${parsed.version} (all platform packages)`)

  io.console.log('Npm finalization complete. Asset delivery will publish and announce the GitHub Release.')
  return 0
}

if (import.meta.main) {
  const code = await finalize()
  process.exit(code)
}
