import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../commands.ts'
import { BuildView } from '../tui/views/build/build-view.tsx'

export const buildCommand: Command = {
  name: 'build',
  description: 'Build a facet from the current directory',
  run: async (args: string[]): Promise<number> => {
    const rootDir = args[0] || process.cwd()
    const displayDir = args[0] || '.'

    // Track result for stdout summary after Ink exits
    let buildName = ''
    let buildVersion = ''
    let artifactCount = 0
    let integrity = ''
    let errorCount = 0

    const instance = render(
      createElement(BuildView, {
        rootDir,
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
