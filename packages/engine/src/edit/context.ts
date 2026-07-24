import { loadManifest } from '../loaders/facet.ts'
import { isReadmePath, README_PATHS, type ReadmePath } from '../readme.ts'
import { computeReadmeStates } from './readme-state.ts'
import { reconcile } from './reconcile.ts'
import { reconcileSupplementary, type SupplementaryDiscovery } from './reconcile-supplementary.ts'
import { scanAssets, scanCommonRootFiles, scanSkillCompanions } from './scanner.ts'
import type { EditContext, ReconciliationItem } from './types.ts'

/**
 * Load a facet manifest, scan its assets and supplementary files, and reconcile
 * manifest ↔ disk into the list of items needing user resolution plus the two
 * independent README panel states. The CLI passes a callback that routes errors
 * to stderr; tests can pass a no-op or array collector.
 */
export async function buildEditContext(
  rootDir: string,
  opts: { onError?: (line: string) => void } = {},
): Promise<{ ok: true; context: EditContext } | { ok: false; exitCode: number }> {
  const loadResult = await loadManifest(rootDir)
  if (!loadResult.ok) {
    opts.onError?.('Manifest is invalid:')
    for (const err of loadResult.errors) {
      opts.onError?.(`  ${err.message}`)
    }
    opts.onError?.('\nFix facet.json and try again.')
    return { ok: false, exitCode: 1 }
  }

  const manifest = loadResult.data

  // Conventional primary assets: reconcile disk against manifest declarations.
  const discovered = await scanAssets(rootDir)
  const assetRecon = reconcile(manifest, discovered)

  const items: ReconciliationItem[] = []
  for (const addition of assetRecon.additions) {
    items.push({ kind: 'asset-addition', assetType: addition.type, name: addition.name, path: addition.path })
  }
  for (const missing of assetRecon.missing) {
    items.push({
      kind: 'asset-missing',
      assetType: missing.type,
      name: missing.name,
      expectedPath: missing.expectedPath,
    })
  }
  // Matched assets are not inspected. Author-supplied front matter in matched
  // files is permitted and reconciled at install time, not at edit time.

  // Supplementary files: companions under declared skills + common/declared
  // top-level files (README excluded, routed to the README panel below).
  const companionsBySkill: Record<string, string[]> = {}
  for (const skill of Object.keys(manifest.skills ?? {})) {
    companionsBySkill[skill] = await scanSkillCompanions(rootDir, skill)
  }
  const presentRootFiles = await computePresentRootFiles(rootDir, manifest.files ?? [])
  const disc: SupplementaryDiscovery = { companionsBySkill, presentRootFiles }
  items.push(...reconcileSupplementary(manifest, disc))

  // README panel: read each conventional path that exists.
  const present: Partial<Record<ReadmePath, string>> = {}
  for (const path of README_PATHS) {
    const file = Bun.file(`${rootDir}/${path}`)
    if (await file.exists()) present[path] = await file.text()
  }
  const readme = computeReadmeStates(manifest, { present })

  return { ok: true, context: { rootDir, manifest, reconciliationItems: items, readme } }
}

/**
 * The set of top-level repo-relative paths present on disk that are candidates
 * for reconciliation: present common root files plus present declared top-level
 * files. README paths are excluded.
 */
async function computePresentRootFiles(rootDir: string, declaredFiles: string[]): Promise<string[]> {
  const present = new Set(await scanCommonRootFiles(rootDir))
  for (const path of declaredFiles) {
    if (isReadmePath(path)) continue
    // Only top-level declarations belong here; skill companions live under skills/.
    if (path.startsWith('skills/')) continue
    if (await Bun.file(`${rootDir}/${path}`).exists()) present.add(path)
  }
  return Array.from(present).sort()
}
