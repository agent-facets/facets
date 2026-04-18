/**
 * CI orchestration logic — composes IO operations for CI pipelines.
 *
 * This module contains ONLY logic. All side effects (shell, file, network)
 * are delegated to io.ts, which makes everything here testable via mocks.
 */

import type { WorkspacePackage } from './changesets'
import { io } from './io'

/** Mint a GitHub App installation token and set GH_TOKEN + GITHUB_TOKEN. */
export async function mintGithubTokens(): Promise<void> {
  const token = await io.shell.mintGitHubAppToken()
  process.env.GH_TOKEN = token
  process.env.GITHUB_TOKEN = token
}

/** Discover all workspace packages by scanning workspace patterns from root package.json. */
export async function loadWorkspacePackages(): Promise<WorkspacePackage[]> {
  const root = await io.shell.readJson('package.json')
  const patterns: string[] = root.workspaces?.packages ?? root.workspaces ?? []
  const results: WorkspacePackage[] = []

  for (const pattern of patterns) {
    const dirs = await io.shell.globScan(pattern, { onlyFiles: false })
    for (const dir of dirs) {
      if (await io.shell.fileExists(`${dir}/package.json`)) {
        const pkg = await io.shell.readJson(`${dir}/package.json`)
        results.push({ name: pkg.name, version: pkg.version, dir, private: pkg.private })
      }
    }
  }

  return results
}
