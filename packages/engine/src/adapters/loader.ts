import type { Adapter } from '@agent-facets/adapter'
import { type InstalledAdapterInspection, inspectInstalledAdapters } from './inspect.ts'

/** An installed entry that cannot be used: incompatible or broken. */
export type InstalledAdapterFailure = Extract<InstalledAdapterInspection, { kind: 'incompatible' | 'broken' }>

/**
 * Result of `loadInstalledAdapters`. Loading fails closed: if any
 * installed adapter is incompatible or broken, the failure arm carries
 * ALL collected failures and no adapters are returned. This prevents an
 * incompatible-but-present adapter from being misreported as "no
 * adapters installed" or as unknown facet metadata.
 */
export type LoadAdaptersResult = { ok: true; adapters: Adapter[] } | { ok: false; failures: InstalledAdapterFailure[] }

/**
 * Loads all installed adapters through shared inspection. Managed
 * installations are validated against their receipts (recorded
 * unsupported APIs fail before import); unmanaged legacy bundles are
 * verified directly. No adapter contract method is invoked before its
 * compatibility has been established.
 *
 * @param baseDir - Base directory for installed adapters (defaults to
 *   `$FACET_DIR/adapters`, where `FACET_DIR` defaults to `~/.facet`)
 */
export async function loadInstalledAdapters(baseDir?: string): Promise<LoadAdaptersResult> {
  const inspections = await inspectInstalledAdapters(baseDir)

  const failures: InstalledAdapterFailure[] = []
  const adapters: Adapter[] = []
  for (const inspection of inspections) {
    if (inspection.kind === 'compatible') {
      adapters.push(inspection.verified.adapter)
    } else {
      failures.push(inspection)
    }
  }

  if (failures.length > 0) {
    return { ok: false, failures }
  }
  return { ok: true, adapters }
}
