import { loadManifest } from '../loaders/facet.ts'
import { reconcile } from './reconcile.ts'
import { scanAssets } from './scanner.ts'
import type { EditContext, ReconciliationItem } from './types.ts'

/**
 * Load a facet manifest, scan its assets, and reconcile manifest ↔ disk into
 * a list of items that need user resolution. The CLI passes a callback that
 * routes errors to stderr; tests can pass a no-op or array collector.
 */
export async function buildEditContext(
  rootDir: string,
  opts: { onError?: (line: string) => void } = {},
): Promise<{ ok: true; context: EditContext } | { ok: false; exitCode: number }> {
  // Load manifest
  const loadResult = await loadManifest(rootDir)
  if (!loadResult.ok) {
    // Hard error — surface details and bail
    opts.onError?.('Manifest is invalid:')
    for (const err of loadResult.errors) {
      opts.onError?.(`  ${err.message}`)
    }
    opts.onError?.('\nFix facet.json and try again.')
    return { ok: false, exitCode: 1 }
  }

  const manifest = loadResult.data

  // Scan disk for assets
  const discovered = await scanAssets(rootDir)

  // Run reconciliation
  const recon = reconcile(manifest, discovered)

  // Build reconciliation items
  const items: ReconciliationItem[] = []

  for (const addition of recon.additions) {
    items.push({ kind: 'addition', type: addition.type, name: addition.name, path: addition.path })
  }

  for (const missing of recon.missing) {
    items.push({ kind: 'missing', type: missing.type, name: missing.name, expectedPath: missing.expectedPath })
  }

  // Matched assets are not inspected. Author-supplied front matter in
  // matched files is permitted and reconciled at install time, not at
  // edit time — see `materialize` and the SDK's `assembleAssetContent`.

  return { ok: true, context: { rootDir, manifest, reconciliationItems: items } }
}
