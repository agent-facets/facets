import type { Adapter } from '@agent-facets/adapter'
import {
  type AdapterCompatibilityFailure,
  classifyApiDeclaration,
  failureForClassification,
  SUPPORTED_ADAPTER_APIS,
} from './api-compatibility.ts'

/**
 * A bundle that passed every verification check.
 *
 * The declared API is not carried beside the adapter: `Adapter` is tagged by
 * `apiVersion`, so consumers (receipts, listings) read `adapter.apiVersion`
 * and there is no second copy that could disagree with the object it
 * describes.
 */
export interface VerifiedAdapter {
  adapter: Adapter
}

/**
 * Discriminated verification failure, ordered by the check sequence:
 *
 *   1. `import-failed` — the bundle could not be dynamically imported.
 *   2. `no-default-export` — the module has no default object export.
 *   3./4./5. `incompatible` — the runtime API declaration is missing,
 *      malformed, unsupported, or disagrees with the npm package
 *      declaration used for selection.
 *   6. `invalid-name` / `invalid-shape` — the verified adapter object is
 *      missing its name or a required asset method.
 *   7. `invalid-capability` — the object satisfies the asset contract but not
 *      the additional shape its declared API promises.
 *
 * A compatibility contradiction is classified before any adapter
 * contract method could be invoked; verification never calls one.
 */
export type VerifyAdapterFailure =
  | { kind: 'import-failed'; bundlePath: string; cause: string }
  | { kind: 'no-default-export'; bundlePath: string }
  | { kind: 'incompatible'; bundlePath: string; failure: AdapterCompatibilityFailure }
  | { kind: 'invalid-name'; bundlePath: string }
  | { kind: 'invalid-shape'; adapter: string; bundlePath: string; detail: string }
  | { kind: 'invalid-capability'; adapter: string; bundlePath: string; api: string; detail: string }

/** Result of `verifyAdapter`. Discriminated by `ok`; never throws for expected failures. */
export type VerifyAdapterResult = { ok: true; verified: VerifiedAdapter } | { ok: false; failure: VerifyAdapterFailure }

/**
 * The methods every supported adapter object must expose regardless of which
 * capabilities it declares. Materialization now lives behind those
 * capabilities, so only metadata validation is unconditional.
 */
const REQUIRED_METHODS = ['buildAssetMetadata'] as const

/**
 * Read a property off an untrusted imported object.
 *
 * A bundle is arbitrary code, and a property access can run a getter that
 * throws. Without this, such a throw would escape `verifyAdapter` entirely and
 * bypass its result contract — the one function whose whole job is to decide
 * whether this object can be trusted.
 */
function safeRead(target: Record<string, unknown>, key: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: target[key] }
  } catch {
    return { ok: false }
  }
}

/**
 * Verifies that a built adapter.js file exports a valid, compatible
 * Adapter object. Dynamically imports the file and checks, in order:
 * importability, default export, runtime API declaration syntax, CLI
 * support, optional npm-metadata equality, then the supported adapter's
 * name and method shape.
 *
 * Importing an ESM bundle necessarily runs its top-level initialization;
 * no adapter *contract method* is invoked here.
 *
 * @param bundlePath - Absolute path to the built adapter.js file
 * @param opts.expectedApiVersion - The npm package declaration used to
 *   select this candidate, when installing from npm. Verification fails
 *   with `api-metadata-mismatch` when the runtime declaration differs.
 */
export async function verifyAdapter(
  bundlePath: string,
  opts: { expectedApiVersion?: string } = {},
): Promise<VerifyAdapterResult> {
  // 1. Importability
  let module: Record<string, unknown>
  try {
    module = (await import(bundlePath)) as Record<string, unknown>
  } catch (err) {
    return {
      ok: false,
      failure: { kind: 'import-failed', bundlePath, cause: err instanceof Error ? err.message : String(err) },
    }
  }

  // 2. Default object export
  const candidate = module.default
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, failure: { kind: 'no-default-export', bundlePath } }
  }
  const adapter = candidate as Record<string, unknown>
  const readName = safeRead(adapter, 'name')
  const declaredName = readName.ok ? readName.value : undefined
  const identity = typeof declaredName === 'string' && declaredName ? declaredName : bundlePath

  // 3./4. Runtime API declaration: present, well-formed, supported
  const readApi = safeRead(adapter, 'apiVersion')
  // A throwing `apiVersion` getter declares nothing readable, which is exactly
  // what `missing` means to the classifier.
  const classified = classifyApiDeclaration(readApi.ok ? readApi.value : undefined)
  if (classified.kind !== 'supported') {
    return {
      ok: false,
      failure: { kind: 'incompatible', bundlePath, failure: failureForClassification(identity, classified) },
    }
  }

  // 5. npm package declaration must equal the runtime declaration
  if (opts.expectedApiVersion !== undefined && opts.expectedApiVersion !== classified.api) {
    return {
      ok: false,
      failure: {
        kind: 'incompatible',
        bundlePath,
        failure: {
          kind: 'api-metadata-mismatch',
          adapter: identity,
          packageDeclared: opts.expectedApiVersion,
          runtimeDeclared: classified.api,
          supported: SUPPORTED_ADAPTER_APIS,
        },
      },
    }
  }

  // 6. Name and the one method every adapter must expose
  if (typeof declaredName !== 'string' || !declaredName) {
    return { ok: false, failure: { kind: 'invalid-name', bundlePath } }
  }
  for (const method of REQUIRED_METHODS) {
    const read = safeRead(adapter, method)
    if (!read.ok || typeof read.value !== 'function') {
      return {
        ok: false,
        failure: {
          kind: 'invalid-shape',
          adapter: declaredName,
          bundlePath,
          detail: `"${method}" is not a function`,
        },
      }
    }
  }

  // 7. Both capabilities. Each is `false` or complete — a partial one would be
  // an adapter that states support and is missing the method providing it.
  for (const capability of CAPABILITIES) {
    const read = safeRead(adapter, capability.field)
    if (!read.ok) {
      return {
        ok: false,
        failure: {
          kind: 'invalid-capability',
          adapter: declaredName,
          bundlePath,
          api: classified.api,
          detail: `"${capability.field}" could not be read`,
        },
      }
    }
    const detail = checkCapabilityShape(read.value, capability.field, capability.operations)
    if (detail !== null) {
      return {
        ok: false,
        failure: { kind: 'invalid-capability', adapter: declaredName, bundlePath, api: classified.api, detail },
      }
    }
  }

  return { ok: true, verified: { adapter: candidate as Adapter } }
}

/**
 * The capability members a current adapter declares, and what each must expose
 * when it is not `false`.
 *
 * One table rather than two near-identical checks: the rule is the same for
 * both, and stating it twice is how they drift.
 */
const CAPABILITIES = [
  { field: 'assets', operations: ['planInstall', 'planRemoval'] },
  { field: 'mcpServers', operations: ['plan'] },
] as const

/**
 * Validate one capability member. Returns null when valid, otherwise a
 * diagnostic detail.
 *
 * Partial capabilities are rejected here as well as in the SDK factory,
 * because a bundle can be built by anything — the factory's guarantee covers
 * adapters built with the factory, and this covers the rest.
 */
function checkCapabilityShape(value: unknown, field: string, operations: readonly string[]): string | null {
  if (value === false) return null
  if (typeof value !== 'object' || value === null) {
    return `"${field}" must be false or a capability object`
  }
  const capability = value as Record<string, unknown>
  for (const operation of operations) {
    const read = safeRead(capability, operation)
    if (!read.ok || typeof read.value !== 'function') {
      return `"${field}.${operation}" is not a function`
    }
  }
  return null
}
