import { loadInstalledAdapters } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../commands.ts'
import { BuildView } from '../tui/views/build/build-view.tsx'
import { resolveTargetDir } from './resolve-dir.ts'

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

    // Load installed adapters so their metadata schemas can validate the manifest
    const adapters = await loadInstalledAdapters(undefined, {
      onWarn: (line) => console.error(line),
    })

    // Track result for stdout summary after Ink exits
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
      process.stdout.write(
        `✓ Built ${buildName} v${buildVersion} → ${displayDir}/dist/ (${artifactCount} assets, ${shortHash})\n`,
      )
      return 0
    } catch {
      process.stdout.write(
        `✗ Build failed — ${errorCount} error${errorCount !== 1 ? 's' : ''}. Run \`facet edit${args[0] ? ` ${displayDir}` : ''}\` to fix.\n`,
      )
      return 1
    }
  },
}
