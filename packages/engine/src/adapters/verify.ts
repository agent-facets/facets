import type { Adapter } from '@agent-facets/adapter'
import {
  type AdapterCompatibilityFailure,
  classifyApiDeclaration,
  SUPPORTED_ADAPTER_APIS,
} from './api-compatibility.ts'

/**
 * A bundle that passed every verification check. `apiVersion` is the
 * exact supported API the runtime bundle declared — carried separately
 * so consumers (receipts, listings) don't re-derive it from the adapter.
 */
export interface VerifiedAdapter {
  adapter: Adapter
  apiVersion: string
}

/**
 * Discriminated verification failure, ordered by the check sequence:
 *
 *   1. `import-failed` — the bundle could not be dynamically imported.
 *   2. `no-default-export` — the module has no default object export.
 *   3./4./5. `incompatible` — the runtime API declaration is missing,
 *      malformed, unsupported, or disagrees with the npm package
 *      declaration used for selection.
 *   6. `invalid-name` / `invalid-shape` — the API `0.0` object is
 *      missing its name or a required method.
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

/** Result of `verifyAdapter`. Discriminated by `ok`; never throws for expected failures. */
export type VerifyAdapterResult = { ok: true; verified: VerifiedAdapter } | { ok: false; failure: VerifyAdapterFailure }

/** The API `0.0` contract methods every adapter object must expose. */
const REQUIRED_METHODS = ['buildAssetMetadata', 'installAsset', 'readAsset', 'deleteAsset'] as const

/**
 * Verifies that a built adapter.js file exports a valid, compatible
 * Adapter object. Dynamically imports the file and checks, in order:
 * importability, default export, runtime API declaration syntax, CLI
 * support, optional npm-metadata equality, then the `0.0` name and
 * method shape.
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
  const identity = typeof adapter.name === 'string' && adapter.name ? adapter.name : bundlePath

  // 3./4. Runtime API declaration: present, well-formed, supported
  const classified = classifyApiDeclaration(adapter.apiVersion)
  switch (classified.kind) {
    case 'missing':
      return {
        ok: false,
        failure: {
          kind: 'incompatible',
          bundlePath,
          failure: { kind: 'api-missing', adapter: identity, supported: SUPPORTED_ADAPTER_APIS },
        },
      }
    case 'malformed':
      return {
        ok: false,
        failure: {
          kind: 'incompatible',
          bundlePath,
          failure: {
            kind: 'api-malformed',
            adapter: identity,
            found: classified.found,
            supported: SUPPORTED_ADAPTER_APIS,
          },
        },
      }
    case 'unsupported':
      return {
        ok: false,
        failure: {
          kind: 'incompatible',
          bundlePath,
          failure: {
            kind: 'api-unsupported',
            adapter: identity,
            found: classified.api,
            supported: SUPPORTED_ADAPTER_APIS,
          },
        },
      }
    case 'supported':
      break
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

  // 6. API `0.0` name and method shape
  if (typeof adapter.name !== 'string' || !adapter.name) {
    return { ok: false, failure: { kind: 'invalid-name', bundlePath } }
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      return {
        ok: false,
        failure: {
          kind: 'invalid-shape',
          adapter: adapter.name,
          bundlePath,
          detail: `"${method}" is not a function`,
        },
      }
    }
  }

  return { ok: true, verified: { adapter: candidate as Adapter, apiVersion: classified.api } }
}
