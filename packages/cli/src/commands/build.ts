import {
  type BuildFailure,
  type BuildResult,
  loadInstalledAdapters,
  runBuildPipeline,
  writeBuildOutput,
} from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../commands.ts'
import { BuildView } from '../tui/views/build/build-view.tsx'
import {
  buildFailureMessages,
  compatibilityFailureMessage,
  describeInstalledAdapterFailure,
} from '../util/adapter-install-errors.ts'
import { writeCliError } from '../util/errors.ts'
import { resolveTargetDir } from './resolve-dir.ts'

/**
 * Version tag for the machine-readable `--json` output document.
 *
 * `2` replaces the `assets` array (primary-asset paths only) with a complete
 * `files` array (every inner-archive entry — manifest, primaries, and
 * supplementary files) and adds `facetVersion`. Consumers pinned to schema
 * `1` must migrate rather than silently receive a different `assets` set.
 */
const BUILD_JSON_SCHEMA_VERSION = '2'

export const buildCommand: Command = {
  name: 'build',
  description: 'Build a facet from the current directory',
  usage: '[directory]',
  implemented: true,
  flags: {
    'emit-manifest': {
      type: 'boolean',
      description: 'Write a loose build-manifest.json to dist/ alongside the .facet file',
    },
    verify: {
      type: 'boolean',
      description: 'Validate the facet without writing any output (no dist/ writes)',
    },
    json: {
      type: 'boolean',
      description: 'Emit machine-readable JSON to stdout instead of the interactive view',
    },
  },
  run: async (args: string[], flags: Record<string, unknown>): Promise<number> => {
    const resolved = await resolveTargetDir(args[0], { mustExist: true, facetMustExist: true })
    if (!resolved.ok) {
      console.error(resolved.message)
      return 1
    }

    const rootDir = resolved.dir
    const displayDir = resolved.display
    const emitManifest = flags['emit-manifest'] === true
    const verify = flags.verify === true
    const json = flags.json === true

    // Load installed adapters so their metadata schemas can validate the
    // manifest. Loading fails closed: any incompatible or broken installed
    // adapter stops the build before the pipeline starts.
    const loaded = await loadInstalledAdapters()
    if (!loaded.ok) {
      for (const failure of loaded.failures) {
        writeCliError(describeInstalledAdapterFailure(failure))
      }
      return 1
    }
    const adapters = loaded.adapters

    // --verify or --json take the plain (non-Ink) path: run the pipeline
    // directly, and only write output when not verifying.
    if (verify || json) {
      const result = await runBuildPipeline(rootDir, adapters)
      const wrote = !verify && result.ok
      if (wrote && result.ok) {
        await writeBuildOutput(result, rootDir, { emitManifest })
      }
      if (json) {
        printBuildJson(result, verify)
      } else {
        printBuildPlain(result, verify, displayDir)
      }
      return result.ok ? 0 : 1
    }

    // Default interactive path — unchanged.
    let buildName = ''
    let buildVersion = ''
    let artifactCount = 0
    let integrity = ''
    let errorCount = 0

    const instance = render(
      createElement(BuildView, {
        rootDir,
        emitManifest,
        adapters,
        onSuccess: (name: string, version: string, fileCount: number, hash: string) => {
          buildName = name
          buildVersion = version
          artifactCount = fileCount
          integrity = hash
        },
        onFailure: (count: number) => {
          errorCount = count
        },
      }),
    )

    try {
      await instance.waitUntilExit()
      // Ink has unmounted — print stdout summary for scroll-back
      const shortHash = integrity.length > 20 ? `${integrity.slice(0, 20)}...` : integrity
      const entries = `${artifactCount} entr${artifactCount !== 1 ? 'ies' : 'y'}`
      process.stdout.write(`✓ Built ${buildName} v${buildVersion} → ${displayDir}/dist/ (${entries}, ${shortHash})\n`)
      return 0
    } catch {
      process.stdout.write(
        `✗ Build failed — ${errorCount} error${errorCount !== 1 ? 's' : ''}. Run \`facet edit${args[0] ? ` ${displayDir}` : ''}\` to fix.\n`,
      )
      return 1
    }
  },
}

/**
 * Emit the versioned JSON build document to stdout. `verified` is true when
 * the run was a `--verify` (no output written); false for a real build.
 */
function printBuildJson(result: BuildResult | BuildFailure, verified: boolean): void {
  const doc = result.ok
    ? {
        schemaVersion: BUILD_JSON_SCHEMA_VERSION,
        ok: true,
        verified,
        name: result.data.name,
        version: result.data.version,
        facetVersion: result.facetVersion,
        // Complete inner-archive entry listing: facet.json, every primary
        // asset, and every supplementary file (skill companions + archive-only).
        files: Object.keys(result.fileHashes).sort(),
        integrity: result.integrity,
        warnings: result.warnings,
      }
    : {
        schemaVersion: BUILD_JSON_SCHEMA_VERSION,
        ok: false,
        verified,
        errors:
          result.kind === 'validation'
            ? result.errors.map((e) => ({ message: e.message, path: e.path }))
            : result.failures.map((failure) => ({
                message: compatibilityFailureMessage(failure),
                path: `adapters.${failure.adapter}`,
              })),
        warnings: result.warnings,
      }
  process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`)
}

/** Plain-text summary for the `--verify` (non-JSON) path. */
function printBuildPlain(result: BuildResult | BuildFailure, verified: boolean, displayDir: string): void {
  for (const warning of result.warnings) {
    process.stderr.write(`⚠ ${warning}\n`)
  }
  if (result.ok) {
    // Count every inner-archive entry, not just primary assets.
    const entryCount = Object.keys(result.fileHashes).length
    const entries = `${entryCount} entr${entryCount !== 1 ? 'ies' : 'y'}`
    if (verified) {
      process.stdout.write(
        `✓ Verified ${result.data.name} v${result.data.version} (facetVersion ${result.facetVersion}, ${entries}, no output written)\n`,
      )
    } else {
      process.stdout.write(
        `✓ Built ${result.data.name} v${result.data.version} → ${displayDir}/dist/ (facetVersion ${result.facetVersion}, ${entries}, ${result.integrity})\n`,
      )
    }
    return
  }
  const messages = buildFailureMessages(result)
  process.stderr.write(
    `✗ ${verified ? 'Verification' : 'Build'} failed — ${messages.length} error${messages.length !== 1 ? 's' : ''}:\n`,
  )
  for (const message of messages) {
    process.stderr.write(`  ${message}\n`)
  }
}
