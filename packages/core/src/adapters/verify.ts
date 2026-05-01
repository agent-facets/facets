import type { Adapter } from '@agent-facets/adapter'

/**
 * Verifies that a built adapter.js file exports a valid Adapter object.
 * Dynamically imports the file and checks its shape.
 *
 * @param bundlePath - Absolute path to the built adapter.js file
 * @returns The loaded Adapter object
 */
export async function verifyAdapter(bundlePath: string): Promise<Adapter> {
  let module: Record<string, unknown>

  try {
    module = (await import(bundlePath)) as Record<string, unknown>
  } catch (err) {
    throw new Error(`Failed to load adapter from "${bundlePath}": ${err instanceof Error ? err.message : String(err)}`)
  }

  // Check for default export
  const adapter = module.default as Adapter | undefined
  if (!adapter) {
    throw new Error(
      `Adapter at "${bundlePath}" does not have a default export. Adapter packages must export default from defineAdapter().`,
    )
  }

  // Validate the Adapter shape
  if (typeof adapter.name !== 'string' || !adapter.name) {
    throw new Error(`Adapter at "${bundlePath}" has an invalid or missing "name" field.`)
  }

  if (typeof adapter.buildAssetMetadata !== 'function') {
    throw new Error(`Adapter "${adapter.name}" has an invalid "buildAssetMetadata" field.`)
  }

  return adapter
}
