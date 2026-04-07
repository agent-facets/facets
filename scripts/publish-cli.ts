#!/usr/bin/env bun

/**
 * Publish CLI platform packages and the wrapper package to npm.
 *
 * Expects built binaries in packages/cli/dist/ (from scripts/build-cli.ts).
 * Publishes all 12 platform packages and the synthesized wrapper package
 * with --tag staging. Idempotent — skips already-published versions.
 *
 * Usage: bun scripts/publish-cli.ts
 */

import path from 'node:path'
import { $ } from 'bun'
import { CLI_WRAPPER_NAME } from './lib/build-cli'
import { io } from './lib/io'
import { versionExists } from './lib/npm'

const CLI_DIR = path.resolve(import.meta.dir, '..', 'packages', 'cli')
const DIST_DIR = path.join(CLI_DIR, 'dist')
const TAG = 'staging'

function log(msg: string) {
  console.log(msg)
}

// ---------------------------------------------------------------------------
// 1. Discover platform packages from build output
// ---------------------------------------------------------------------------

async function discoverPlatformPackages(): Promise<Record<string, string>> {
  const binaries: Record<string, string> = {}

  // Scoped packages live at dist/@agent-facets/cli-*/package.json
  for await (const filepath of new Bun.Glob('@*/*/package.json').scanSync({ cwd: DIST_DIR })) {
    const pkg = await Bun.file(path.join(DIST_DIR, filepath)).json()
    binaries[pkg.name] = pkg.version
  }

  if (Object.keys(binaries).length === 0) {
    throw new Error(`No platform packages found in ${DIST_DIR}. Did you run the build first?`)
  }

  return binaries
}

// ---------------------------------------------------------------------------
// 2. Publish platform packages
// ---------------------------------------------------------------------------

async function publishPlatformPackages(binaries: Record<string, string>): Promise<void> {
  const entries = Object.entries(binaries)
  log(`\n   Publishing ${entries.length} platform packages to staging...\n`)

  const tasks = entries.map(async ([name, version]) => {
    if (await versionExists(name, version)) {
      log(`   ~ ${name}@${version} (already published, skipping)`)
      return
    }

    // Scoped package dir: dist/@agent-facets/cli-darwin-arm64
    const dirName = name.replace('@agent-facets/', '')
    const pkgDir = path.join(DIST_DIR, '@agent-facets', dirName)

    if (process.platform !== 'win32') {
      await io.chmod(pkgDir)
    }
    await io.pack(pkgDir)
    await io.publish(pkgDir, TAG)
    log(`   + ${name}@${version} published (staging)`)
  })

  const results = await Promise.allSettled(tasks)
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    for (const f of failures) console.error('   Failed:', f.reason)
    throw new Error(`${failures.length} platform package(s) failed to publish`)
  }
}

// ---------------------------------------------------------------------------
// 3. Synthesize and publish wrapper package
// ---------------------------------------------------------------------------

async function publishWrapper(binaries: Record<string, string>, version: string): Promise<void> {
  const wrapperDir = path.join(DIST_DIR, CLI_WRAPPER_NAME)

  log(`\n   Synthesizing wrapper package ${CLI_WRAPPER_NAME}@${version}...`)

  if (await versionExists(CLI_WRAPPER_NAME, version)) {
    log(`   ~ ${CLI_WRAPPER_NAME}@${version} (already published, skipping)`)
    return
  }

  // Create wrapper directory structure
  await $`mkdir -p ${wrapperDir}/bin`
  await $`cp ${path.join(CLI_DIR, 'bin', 'facet')} ${wrapperDir}/bin/facet`
  await $`cp ${path.join(CLI_DIR, 'bin', 'package.json')} ${wrapperDir}/bin/package.json`
  await $`cp ${path.join(CLI_DIR, 'scripts', 'postinstall.mjs')} ${wrapperDir}/postinstall.mjs`

  // Generate wrapper package.json
  await io.writeFile(
    path.join(wrapperDir, 'package.json'),
    JSON.stringify(
      {
        name: CLI_WRAPPER_NAME,
        version,
        bin: {
          facet: './bin/facet',
        },
        scripts: {
          postinstall: 'node ./postinstall.mjs',
        },
        optionalDependencies: binaries,
      },
      null,
      2,
    ),
  )

  // Pack and publish
  await io.pack(wrapperDir)
  await io.publish(wrapperDir, TAG)
  log(`   + ${CLI_WRAPPER_NAME}@${version} published (staging)`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('\n=== Publish CLI Packages ===')

  const binaries = await discoverPlatformPackages()
  const versions = Object.values(binaries)
  const version = versions[0]
  if (!version) {
    throw new Error('No platform packages found — cannot determine version')
  }
  log(`\n   Found ${Object.keys(binaries).length} platform packages at version ${version}`)

  await publishPlatformPackages(binaries)
  await publishWrapper(binaries, version)

  log('\n=== All packages published to staging ===')
  log(`\n   To promote to latest (after verification):`)
  log(`   npm dist-tag add ${CLI_WRAPPER_NAME}@${version} latest`)
  log(`   (and for each platform package)`)
}

main().catch((err) => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
