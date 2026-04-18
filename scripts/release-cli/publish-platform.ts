#!/usr/bin/env bun

/**
 * Publish a single platform package to npm with --tag latest.
 *
 * Used by the matrix publish job in the release-cli workflow.
 * Each matrix instance publishes one platform package in its own
 * executor, avoiding OOM from concurrent publishes.
 *
 * Idempotent — skips if the version is already published.
 *
 * Usage: bun scripts/release-cli/publish-platform.ts <target>
 *   e.g. bun scripts/release-cli/publish-platform.ts cli-darwin-arm64
 */

import path from 'node:path'
import { DIST_DIR, PUBLISH_TAG } from '../lib/constants'
import { io } from '../lib/io'
import { mintNpmToken, versionExists } from '../lib/npm'

export async function publishSingle(target: string): Promise<number> {
  // Mint OIDC token for npm trusted publishing (each matrix job needs its own)
  await mintNpmToken()

  const pkgDir = path.join(DIST_DIR, '@agent-facets', target)
  const pkgJsonPath = path.join(pkgDir, 'package.json')

  let pkgJson: { name: string; version: string }
  try {
    pkgJson = await io.shell.readJson(pkgJsonPath)
  } catch {
    console.error(`Could not read ${pkgJsonPath}. Did the build job produce this target?`)
    return 1
  }

  const { name, version } = pkgJson

  console.log(`Publishing ${name}@${version}...`)

  if (await versionExists(name, version)) {
    console.log(`~ ${name}@${version} already published, skipping`)
    return 0
  }

  if (process.platform !== 'win32') {
    await io.shell.chmod(pkgDir)
  }
  await io.shell.pack(pkgDir)
  await io.npm.publishTarball(pkgDir, PUBLISH_TAG)

  console.log(`+ ${name}@${version} published (latest)`)
  return 0
}

if (import.meta.main) {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: bun scripts/release-cli/publish-platform.ts <target>')
    console.error('  e.g. bun scripts/release-cli/publish-platform.ts cli-darwin-arm64')
    process.exit(1)
  }
  const code = await publishSingle(target)
  process.exit(code)
}
