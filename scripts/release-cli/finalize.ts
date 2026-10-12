#!/usr/bin/env bun

/**
 * Finalize a CLI release — wait for platforms, publish cli package, wait, announce.
 *
 * Runs after npm has accepted all 12 platform packages from the matrix
 * publish jobs. Acceptance is not availability: npm scans each version before
 * serving it. This script:
 *
 * 1. Mints a GitHub App token (for GitHub Release creation)
 * 2. Waits until all 12 platform packages are available on npm
 * 3. Publishes the cli package (agent-facets) directly to latest
 * 4. Waits until the cli package is available on npm
 * 5. Creates a GitHub Release and sends a notification
 *
 * Safety: the cli package is always the last package published, and only
 * once every platform package it depends on is available. If a wait times
 * out, the script exits nonzero before publishing or announcing anything
 * further. Rerunning the job is safe: the wrapper publish skips a version
 * that already exists.
 *
 * Invoked by the `finalize-cli` job in the release-cli CircleCI workflow.
 */

import { announceRelease } from '../lib/announce'
import { loadWorkspacePackages, mintGithubTokens } from '../lib/ci'
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

  // Mint GitHub token (for Release creation; npm OIDC is handled by the publish script)
  await mintGithubTokens()

  // Wait for the 12 platform packages to be available on npm before publishing the CLI wrapper.
  // The CLI package's optionalDependencies must be resolvable when users install it.
  io.console.log('Waiting for platform packages to become available on npm...')
  const platforms = await io.shell.verifyPackages(platformPackageNames(), parsed.version)
  if (platforms.exitCode !== 0) {
    io.console.error(
      `Platform packages for ${parsed.version} are not all available on npm. ` +
        `${CLI_PACKAGE_NAME} was NOT published and the release was not announced.\n` +
        'Do not republish the platform packages. Once npm makes them available, rerun this job.',
    )
    return 1
  }

  // Publish CLI package to latest (synthesizes from build output, mints its own OIDC token).
  // The wrapper is always the LAST package published — users cannot install the new version
  // until this completes successfully.
  io.console.log('Publishing CLI package...')
  await io.shell.publishCliPackage()

  // Wait for the CLI wrapper itself to be available on npm before announcing.
  io.console.log('Waiting for CLI package to become available on npm...')
  const wrapper = await io.shell.verifyPackages([CLI_PACKAGE_NAME], parsed.version)
  if (wrapper.exitCode !== 0) {
    io.console.error(
      `${CLI_PACKAGE_NAME}@${parsed.version} was published but is not available on npm yet; ` +
        'the release was not announced.\n' +
        'Do not republish. Once npm makes it available, rerun this job: it skips the existing publish and announces.',
    )
    return 1
  }

  io.console.log(`Published ${parsed.name}@${parsed.version} (all platform packages)`)

  // Announce
  const packages = await loadWorkspacePackages()
  const pkg = packages.find((p) => p.name === parsed.name)
  if (pkg) {
    await announceRelease(tag, pkg.dir, parsed.version)
  }

  io.console.log('Done.')
  return 0
}

if (import.meta.main) {
  const code = await finalize()
  process.exit(code)
}
