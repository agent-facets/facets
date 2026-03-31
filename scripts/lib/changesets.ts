export interface WorkspacePackage {
  name: string
  version: string
  private?: boolean
}

/**
 * Given a list of filenames from the .changeset directory,
 * returns only the ones that are actual changesets (not README.md).
 */
export function filterPendingChangesets(files: string[]): string[] {
  return files.filter((f) => f.endsWith('.md') && f !== 'README.md')
}

/**
 * Determine whether we should publish (no pending changesets)
 * or create a version PR (pending changesets exist).
 */
export function shouldPublish(pendingChangesets: string[]): boolean {
  return pendingChangesets.length === 0
}

/**
 * Check whether any non-private workspace package has a local version
 * that doesn't yet exist on the npm registry.
 */
export async function hasUnpublishedVersions(
  packages: WorkspacePackage[],
  npmViewFn: (pkg: string) => Promise<string | null>,
): Promise<boolean> {
  const publishable = packages.filter((p) => !p.private)

  for (const pkg of publishable) {
    const npmVersion = await npmViewFn(pkg.name)
    if (npmVersion !== pkg.version) return true
  }

  return false
}
