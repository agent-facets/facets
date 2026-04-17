import type { Harness } from '@agent-facets/harness'

/**
 * Verifies that a built harness.js file exports a valid Harness object.
 * Dynamically imports the file and checks its shape.
 *
 * @param bundlePath - Absolute path to the built harness.js file
 * @returns The loaded Harness object
 */
export async function verifyHarness(bundlePath: string): Promise<Harness> {
  let module: Record<string, unknown>

  try {
    module = (await import(bundlePath)) as Record<string, unknown>
  } catch (err) {
    throw new Error(`Failed to load harness from "${bundlePath}": ${err instanceof Error ? err.message : String(err)}`)
  }

  // Check for default export
  const harness = module.default as Harness | undefined
  if (!harness) {
    throw new Error(
      `Harness at "${bundlePath}" does not have a default export. Harness packages must export default from defineHarness().`,
    )
  }

  // Validate the Harness shape
  if (typeof harness.name !== 'string' || !harness.name) {
    throw new Error(`Harness at "${bundlePath}" has an invalid or missing "name" field.`)
  }

  if (typeof harness.buildAssetMetadata !== 'function') {
    throw new Error(`Harness "${harness.name}" has an invalid "buildAssetMetadata" field.`)
  }

  return harness
}
