#!/usr/bin/env bun

/**
 * Deploy the SST `main` stage. Runs in the CD workflow on merges to main.
 *
 * Pipeline:
 *   1. Pre-flight: verify AWS credentials have been assumed (the aws-cli
 *      orb's `aws-cli/setup` step must have run before this script).
 *   2. `bun sst install` — populate `.sst/platform/` (CI's `postinstall`
 *      skips this via the `[ -n "$CI" ]` guard in `package.json`).
 *   3. `bun sst deploy --stage main` — deploy the `main` stage.
 *
 * Invoked by the `deploy-site` job in the `deploy` CircleCI workflow.
 */

import { io } from '../lib/io'

export async function deploySite(): Promise<number> {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    io.console.error('AWS credentials not set. aws-cli orb setup must run before this script.')
    return 1
  }

  io.console.log('Installing SST platform files...')
  await io.shell.sstInstall()

  io.console.log('Deploying SST `main` stage...')
  await io.shell.sstDeployMain()

  io.console.log('Done.')
  return 0
}

if (import.meta.main) {
  const code = await deploySite()
  process.exit(code)
}
