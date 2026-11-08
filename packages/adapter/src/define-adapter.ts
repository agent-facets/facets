import type { Validated, ValidationError } from '@agent-facets/common'
import { ADAPTER_API_VERSION } from './api-version.ts'
import { checkSafeAssetName } from './asset-fs.ts'
import type { McpServerCapability, PlanMcpServersRequest, PlanMcpServersResult } from './mcp-servers.ts'
import {
  type CapabilityDeclarations,
  checkPlanningContext,
  type InstallationScope,
  isEnvironmentName,
  isInstallationScope,
  type PlanningContextFailure,
} from './planning-context.ts'
import type {
  Adapter,
  AdapterDefinition,
  AdapterPlanFailure,
  AssetCapability,
  PlanAssetInstallRequest,
  PlanAssetInstallResult,
  PlanAssetRemovalRequest,
  PlanAssetRemovalResult,
} from './types.ts'

/**
 * Create an adapter from a definition object.
 *
 * Returns `{ ok: true, data }` with a frozen `Adapter` stamped with the SDK's
 * canonical adapter SDK API version (`ADAPTER_API_VERSION`), or
 * `{ ok: false, errors }` naming every problem with the definition. An invalid
 * definition is an expected input — an author's mistake, or untyped
 * JavaScript — so it is reported as data and never thrown.
 *
 * Both capabilities are required fields with an explicit `false`. There are no
 * stub defaults: a capability the CLI must know about *before* it plans a
 * transaction cannot be discovered by calling it and being refused. An
 * enabled capability must declare its supported scopes and the environment
 * variables it reads.
 *
 * Every capability operation on the returned adapter first checks the
 * request's planning context against the capability's declarations, and an
 * asset request's name, before the author's planner runs. The planner sees a
 * frozen context holding only the environment variables it declared.
 *
 * @example
 * ```ts
 * import { defineAdapter } from '@agent-facets/adapter'
 *
 * export default defineAdapter({
 *   name: 'opencode',
 *   assets: false,
 *   mcpServers: false,
 *   buildAssetMetadata(data) {
 *     // validate and enrich metadata using arktype or any other library
 *   },
 * })
 * ```
 *
 * The default export is the validation result. Whatever loads it checks
 * `ok` before using `data`.
 */
export function defineAdapter(definition: AdapterDefinition): Validated<Adapter> {
  if (!isRecord(definition)) {
    return {
      ok: false,
      errors: [
        problem('', 'an adapter definition object', describe(definition), 'Adapter definition must be an object'),
      ],
    }
  }

  const errors: ValidationError[] = []

  const name = read(definition, 'name')
  if (!name.ok || typeof name.value !== 'string' || name.value.length === 0) {
    errors.push(
      problem('name', 'a non-empty string', describeRead(name), '"name" is required and must be a non-empty string'),
    )
  }

  const buildAssetMetadata = read(definition, 'buildAssetMetadata')
  if (!buildAssetMetadata.ok || typeof buildAssetMetadata.value !== 'function') {
    errors.push(
      problem(
        'buildAssetMetadata',
        'a function',
        describeRead(buildAssetMetadata),
        '"buildAssetMetadata" is required and must be a function',
      ),
    )
  }

  const assets = checkCapability(definition, 'assets', ['planInstall', 'planRemoval'], errors)
  const mcpServers = checkCapability(definition, 'mcpServers', ['plan'], errors)

  if (errors.length > 0 || assets === undefined || mcpServers === undefined) return { ok: false, errors }

  const metadataBuilder = (buildAssetMetadata as { value: Adapter['buildAssetMetadata'] }).value
  const adapter: Adapter = {
    name: (name as { value: string }).value,

    // SDK-owned: always the canonical value, even if a non-TypeScript caller
    // sneaks an `apiVersion` past the input type.
    apiVersion: ADAPTER_API_VERSION,

    assets: assets === false ? false : guardAssets(assets),
    mcpServers: mcpServers === false ? false : guardMcpServers(mcpServers),

    buildAssetMetadata: metadataBuilder.bind(definition),
  }

  return { ok: true, data: Object.freeze(adapter) }
}

// --- Definition validation ---

/** An enabled capability as validated: its declarations plus the operations it supplied. */
interface CheckedCapability {
  readonly source: Record<string, unknown>
  readonly declarations: CapabilityDeclarations
  readonly operations: Readonly<Record<string, (request: unknown) => Promise<unknown>>>
}

/**
 * Validate one capability member. Returns `false` for a declined capability,
 * the checked capability when complete, or `undefined` after recording every
 * problem in `errors`.
 *
 * "Complete" is the only accepted form. A capability that can plan an install
 * but not a removal is an adapter that can put files on disk and never take
 * them off, so it is rejected when the adapter is defined rather than
 * discovered when a facet is removed. The checks are structural because an
 * author may reach this factory from untyped JavaScript.
 */
function checkCapability(
  definition: Record<string, unknown>,
  field: 'assets' | 'mcpServers',
  operationNames: readonly string[],
  errors: ValidationError[],
): CheckedCapability | false | undefined {
  const member = read(definition, field)
  if (member.ok && member.value === false) return false
  if (!member.ok || !isRecord(member.value)) {
    errors.push(
      problem(
        field,
        'false or a complete capability object',
        describeRead(member),
        `"${field}" is required and must be either false or a complete capability object`,
      ),
    )
    return undefined
  }

  const source = member.value
  const before = errors.length

  const operations: Record<string, (request: unknown) => Promise<unknown>> = {}
  for (const operation of operationNames) {
    const value = read(source, operation)
    if (value.ok && typeof value.value === 'function') {
      operations[operation] = value.value as (request: unknown) => Promise<unknown>
    } else {
      errors.push(
        problem(
          `${field}.${operation}`,
          'a function',
          describeRead(value),
          `"${field}.${operation}" must be a function`,
        ),
      )
    }
  }

  const supportedScopes = checkSupportedScopes(source, field, errors)
  const locationEnvironment = checkLocationEnvironment(source, field, errors)

  if (errors.length > before || supportedScopes === undefined || locationEnvironment === undefined) return undefined
  return { source, declarations: { supportedScopes, locationEnvironment }, operations }
}

function checkSupportedScopes(
  source: Record<string, unknown>,
  field: string,
  errors: ValidationError[],
): CapabilityDeclarations['supportedScopes'] | undefined {
  const path = `${field}.supportedScopes`
  const items = readList(source, 'supportedScopes')
  if (!items.ok || items.items.length === 0) {
    errors.push(
      problem(
        path,
        'a non-empty list of "project" and/or "user"',
        items.ok ? 'an empty list' : items.actual,
        `"${path}" must list at least one supported installation scope`,
      ),
    )
    return undefined
  }

  const scopes: InstallationScope[] = []
  let valid = true
  items.items.forEach((scope, index) => {
    if (!isInstallationScope(scope)) {
      errors.push(
        problem(`${path}.${index}`, '"project" or "user"', describe(scope), `"${path}" names an unsupported scope`),
      )
      valid = false
    } else if (scopes.includes(scope)) {
      errors.push(
        problem(`${path}.${index}`, 'each scope at most once', `"${scope}" again`, `"${path}" repeats a scope`),
      )
      valid = false
    } else {
      scopes.push(scope)
    }
  })
  const [first, ...rest] = scopes
  return valid && first !== undefined ? Object.freeze([first, ...rest] as const) : undefined
}

function checkLocationEnvironment(
  source: Record<string, unknown>,
  field: string,
  errors: ValidationError[],
): readonly string[] | undefined {
  const path = `${field}.locationEnvironment`
  const items = readList(source, 'locationEnvironment')
  if (!items.ok) {
    errors.push(
      problem(
        path,
        'a list of environment-variable names (empty is valid)',
        items.actual,
        `"${path}" is required and must list the environment variables the capability consults`,
      ),
    )
    return undefined
  }

  const names: string[] = []
  let valid = true
  items.items.forEach((name, index) => {
    if (typeof name !== 'string' || !isEnvironmentName(name)) {
      errors.push(
        problem(
          `${path}.${index}`,
          'an ASCII environment-variable name',
          describe(name),
          `"${path}" contains an invalid environment-variable name`,
        ),
      )
      valid = false
    } else if (names.includes(name)) {
      errors.push(problem(`${path}.${index}`, 'each name at most once', `"${name}" again`, `"${path}" repeats a name`))
      valid = false
    } else {
      names.push(name)
    }
  })
  return valid ? Object.freeze(names) : undefined
}

// --- Request guards ---

/**
 * The asset capability the adapter exposes: the author's planners, behind a
 * check of every request's context and asset name.
 */
function guardAssets(capability: CheckedCapability): AssetCapability {
  const { declarations, operations, source } = capability
  const planInstall = operations.planInstall as AssetCapability['planInstall']
  const planRemoval = operations.planRemoval as AssetCapability['planRemoval']
  return Object.freeze({
    supportedScopes: declarations.supportedScopes,
    locationEnvironment: declarations.locationEnvironment,
    async planInstall(request: PlanAssetInstallRequest): Promise<PlanAssetInstallResult> {
      const checked = checkAssetRequest(request, declarations)
      return checked.ok ? planInstall.call(source, checked.request) : checked
    },
    async planRemoval(request: PlanAssetRemovalRequest): Promise<PlanAssetRemovalResult> {
      const checked = checkAssetRequest(request, declarations)
      return checked.ok ? planRemoval.call(source, checked.request) : checked
    },
  })
}

/** The MCP capability the adapter exposes: the author's planner, behind a check of every request's context. */
function guardMcpServers(capability: CheckedCapability): McpServerCapability {
  const { declarations, operations, source } = capability
  const plan = operations.plan as McpServerCapability['plan']
  return Object.freeze({
    supportedScopes: declarations.supportedScopes,
    locationEnvironment: declarations.locationEnvironment,
    async plan(request: PlanMcpServersRequest): Promise<PlanMcpServersResult> {
      const checked = checkRequestContext(request, declarations)
      return checked.ok ? plan.call(source, checked.request) : checked
    },
  })
}

type GuardedRequest<R, F> = { readonly ok: true; readonly request: R } | { readonly ok: false; readonly failure: F }

/**
 * Refuse a request whose context is malformed or outside the capability's
 * declarations, and otherwise hand the planner a copy carrying the checked,
 * frozen context.
 *
 * The request is typed, but it arrives from whatever called the adapter, so
 * it is examined as untrusted input all the same.
 */
function checkRequestContext<R extends { readonly context: unknown }>(
  request: R,
  declarations: CapabilityDeclarations,
): GuardedRequest<R, PlanningContextFailure> {
  const untrusted: unknown = request
  if (!isRecord(untrusted)) {
    return {
      ok: false,
      failure: { code: 'invalid-target', field: 'request', reason: 'must be a planning request object' },
    }
  }
  const context = read(untrusted, 'context')
  const checked = checkPlanningContext(context.ok ? context.value : undefined, declarations)
  if (!checked.ok) return checked
  try {
    return { ok: true, request: { ...request, context: checked.context } }
  } catch {
    return { ok: false, failure: { code: 'invalid-target', field: 'request', reason: 'could not be read' } }
  }
}

/** The context check, then the asset name — both before any file is inspected. */
function checkAssetRequest<R extends { readonly context: unknown; readonly name: unknown }>(
  request: R,
  declarations: CapabilityDeclarations,
): GuardedRequest<R, AdapterPlanFailure> {
  const checked = checkRequestContext(request, declarations)
  if (!checked.ok) return checked
  const name = checkSafeAssetName(checked.request.name)
  return name.ok ? checked : name
}

// --- Reading untrusted input ---

type ReadResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

/**
 * Read a property of caller-supplied input. A getter or proxy can throw, and
 * a definition that cannot be read is an invalid definition, not a crash.
 */
function read(target: Record<string, unknown>, key: string): ReadResult {
  try {
    return { ok: true, value: target[key] }
  } catch {
    return { ok: false }
  }
}

function readList(
  target: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly items: readonly unknown[] } | { readonly ok: false; readonly actual: string } {
  const value = read(target, key)
  if (!value.ok) return { ok: false, actual: 'an unreadable value' }
  if (!Array.isArray(value.value)) return { ok: false, actual: describe(value.value) }
  try {
    return { ok: true, items: [...value.value] }
  } catch {
    return { ok: false, actual: 'an unreadable list' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return JSON.stringify(value)
  return typeof value
}

function describeRead(value: ReadResult): string {
  return value.ok ? describe(value.value) : 'an unreadable value'
}

function problem(path: string, expected: string, actual: string, message: string): ValidationError {
  return { path, expected, actual, message }
}
