import type { Adapter, ValidationError } from '@agent-facets/adapter'
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
 *   2a. `definition-invalid` — the default export is a `defineAdapter()`
 *       result reporting that the definition was invalid; its field-addressed
 *       errors are carried verbatim. `invalid-export` — the default export is
 *       a result envelope that is itself malformed, so it can be neither
 *       trusted nor read as a bare adapter.
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
  | { kind: 'definition-invalid'; bundlePath: string; errors: readonly ValidationError[] }
  | { kind: 'invalid-export'; bundlePath: string; detail: string }
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
  const exported = module.default
  if (typeof exported !== 'object' || exported === null) {
    return { ok: false, failure: { kind: 'no-default-export', bundlePath } }
  }

  // 2a. A `defineAdapter()` result, or a manually constructed adapter. A
  //     successful envelope only says where the adapter is: everything below
  //     still checks it, so `ok: true` waives nothing.
  const unwrapped = unwrapExport(exported as Record<string, unknown>, bundlePath)
  if (!unwrapped.ok) return unwrapped
  const candidate = unwrapped.adapter
  const adapter = candidate
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

  // Every member the contract requires has now been checked on this object.
  return { ok: true, verified: { adapter: candidate as unknown as Adapter } }
}

/**
 * The adapter a default export carries.
 *
 * Distinguished by the envelope's own discriminant: a bare adapter has no
 * `ok` member, so a value with one is read as a `defineAdapter()` result and
 * held to that shape. A malformed envelope is refused rather than reread as a
 * bare adapter — doing that would let a failed definition through as long as
 * it happened to carry adapter-looking members.
 */
function unwrapExport(
  exported: Record<string, unknown>,
  bundlePath: string,
): { ok: true; adapter: Record<string, unknown> } | { ok: false; failure: VerifyAdapterFailure } {
  const invalid = (detail: string) => ({ ok: false, failure: { kind: 'invalid-export', bundlePath, detail } }) as const

  let isEnvelope: boolean
  try {
    isEnvelope = 'ok' in exported
  } catch {
    return invalid('the default export could not be read')
  }
  if (!isEnvelope) return { ok: true, adapter: exported }

  const discriminant = safeRead(exported, 'ok')
  if (!discriminant.ok || typeof discriminant.value !== 'boolean') {
    return invalid('the default export has an "ok" member that is not a boolean')
  }

  if (discriminant.value) {
    const data = safeRead(exported, 'data')
    if (!data.ok || typeof data.value !== 'object' || data.value === null || Array.isArray(data.value)) {
      return invalid('a successful defineAdapter() result must carry the adapter in "data"')
    }
    return { ok: true, adapter: data.value as Record<string, unknown> }
  }

  const errors = safeRead(exported, 'errors')
  if (!errors.ok || !Array.isArray(errors.value) || errors.value.length === 0) {
    return invalid('a failed defineAdapter() result must carry a non-empty "errors" list')
  }
  const checked: ValidationError[] = []
  for (const error of errors.value as unknown[]) {
    if (!isValidationError(error)) return invalid('a failed defineAdapter() result carries a malformed error')
    checked.push({ path: error.path, message: error.message, expected: error.expected, actual: error.actual })
  }
  return { ok: false, failure: { kind: 'definition-invalid', bundlePath, errors: checked } }
}

function isValidationError(value: unknown): value is ValidationError {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return ['path', 'message', 'expected', 'actual'].every((key) => {
    const read = safeRead(record, key)
    return read.ok && typeof read.value === 'string'
  })
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
  return checkCapabilityDeclarations(capability, field)
}

const INSTALLATION_SCOPES: readonly string[] = ['project', 'user']
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The declarations every enabled capability states before it is called: a
 * non-empty, repeat-free set of supported scopes, and the environment
 * variables it consults. Checked here as well as in the SDK factory, for the
 * same reason as the operations above.
 */
function checkCapabilityDeclarations(capability: Record<string, unknown>, field: string): string | null {
  const scopes = safeRead(capability, 'supportedScopes')
  if (!scopes.ok || !Array.isArray(scopes.value) || scopes.value.length === 0) {
    return `"${field}.supportedScopes" must list at least one of "project" and "user"`
  }
  const seenScopes = new Set<unknown>()
  for (const scope of scopes.value as unknown[]) {
    if (typeof scope !== 'string' || !INSTALLATION_SCOPES.includes(scope)) {
      return `"${field}.supportedScopes" names an unsupported scope: ${String(scope)}`
    }
    if (seenScopes.has(scope)) return `"${field}.supportedScopes" repeats "${scope}"`
    seenScopes.add(scope)
  }

  const names = safeRead(capability, 'locationEnvironment')
  if (!names.ok || !Array.isArray(names.value)) {
    return `"${field}.locationEnvironment" must list the environment variables the capability consults`
  }
  const seenNames = new Set<unknown>()
  for (const name of names.value as unknown[]) {
    if (typeof name !== 'string' || !ENVIRONMENT_NAME.test(name)) {
      return `"${field}.locationEnvironment" contains an invalid environment-variable name: ${String(name)}`
    }
    if (seenNames.has(name)) return `"${field}.locationEnvironment" repeats "${name}"`
    seenNames.add(name)
  }
  return null
}
