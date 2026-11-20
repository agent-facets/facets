import type { Scope } from '@agent-facets/common'

/**
 * Where a planning request is aimed, and what the planner may consult to find
 * it.
 *
 * Every asset and MCP planning request carries one of these. The caller
 * supplies all of it, and an adapter uses nothing else to decide where its
 * tool keeps things: not the process working directory, not the ambient
 * home directory, not the ambient environment. A planner that consulted any
 * of those would resolve a different tree for a caller that is not a shell
 * sitting in the right place — silently.
 */

/**
 * The installation scopes a request can target.
 *
 * System-wide installation is deliberately not representable: no supported
 * operation requests it, so no adapter has to decide what it would mean.
 */
export type InstallationScope = Exclude<Scope, 'system'>

/**
 * The collection a request installs into.
 *
 * Discriminated rather than an optional project root beside a scope tag. That
 * shape could describe a project request with no project, or a user request
 * that names one — and an adapter given either would have to guess.
 */
export type InstallationTarget =
  | {
      readonly scope: 'project'
      /** Absolute path of the project being installed into. */
      readonly projectRoot: string
    }
  | {
      readonly scope: 'user'
      /** A user target is not inside any project, so it never names one. */
      readonly projectRoot?: never
    }

/**
 * Everything an adapter may use to resolve native locations.
 *
 * `homeDirectory` is an input to location resolution, not a destination: the
 * adapter decides where under (or away from) it its tool keeps things.
 * `environment` holds only the variables the receiving capability declared in
 * its `locationEnvironment`, captured once for the whole operation, and is
 * read-only. A declared variable is a native location override; it never
 * supplies a competing home, and naming it confers no ownership of the
 * configuration it points at.
 */
export interface PlanningContext {
  readonly target: InstallationTarget
  readonly homeDirectory: string
  readonly environment: Readonly<Record<string, string | undefined>>
}

/**
 * What every enabled capability states about itself before it is ever called.
 *
 * A caller needs both facts before it plans a transaction: which scopes the
 * capability can serve, so an unsupported request fails before anything is
 * approved, and which environment variables it reads, so it receives those
 * and no others.
 */
export interface CapabilityDeclarations {
  /** Non-empty, without repeats. */
  readonly supportedScopes: readonly [InstallationScope, ...InstallationScope[]]
  /**
   * Every environment-variable name this capability consults to resolve a
   * destination. Empty is valid and common.
   */
  readonly locationEnvironment: readonly string[]
}

/** Why a planning context was refused, before any file was inspected. */
export type PlanningContextFailure =
  /**
   * The request names a scope this capability does not serve — including
   * `system`, which nothing serves.
   */
  | {
      readonly code: 'unsupported-scope'
      readonly scope: string
      readonly supportedScopes: readonly InstallationScope[]
    }
  /**
   * The context is malformed: a project target without an absolute project
   * root, a user target that names one, a home directory that is not
   * absolute, or a non-string location value. `field` is the dotted path of
   * the offending member.
   */
  | { readonly code: 'invalid-target'; readonly field: string; readonly reason: string }

/** Result of {@link checkPlanningContext}. */
export type CheckPlanningContextResult =
  | { readonly ok: true; readonly context: PlanningContext }
  | { readonly ok: false; readonly failure: PlanningContextFailure }

const INSTALLATION_SCOPES: readonly InstallationScope[] = ['project', 'user']

/** Whether a value names an installation scope. */
export function isInstallationScope(value: unknown): value is InstallationScope {
  return typeof value === 'string' && (INSTALLATION_SCOPES as readonly string[]).includes(value)
}

/**
 * The portable environment-variable name grammar: an ASCII letter or
 * underscore, then ASCII letters, digits, or underscores.
 */
const ENVIRONMENT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Whether a string is a portable environment-variable name. */
export function isEnvironmentName(value: string): boolean {
  return ENVIRONMENT_NAME_RE.test(value)
}

/**
 * Whether a path is absolute on a supported platform, independent of the one
 * this process happens to run on.
 *
 * Accepts a POSIX absolute path, a Windows drive-qualified path (`C:\…` or
 * `C:/…`), or a Windows UNC path (`\\server\share…`). A drive-relative
 * `C:foo` or a rooted-but-driveless `\foo` is not absolute: it means
 * different places depending on the current drive, which is exactly the
 * ambiguity a supplied location exists to remove.
 */
export function isAbsoluteLocation(path: string): boolean {
  if (path.length === 0 || path.includes('\0')) return false
  if (path.startsWith('/')) return true
  if (/^[A-Za-z]:[\\/]/.test(path)) return true
  return /^\\\\[^\\/]+[\\/][^\\/]+/.test(path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(field: string, reason: string): CheckPlanningContextResult {
  return { ok: false, failure: { code: 'invalid-target', field, reason } }
}

/**
 * Validate a planning context against one capability's declarations, and
 * return the copy that capability may see.
 *
 * Purely structural: nothing on disk is inspected. The returned context is a
 * new, frozen object whose environment holds only the capability's declared
 * variables, so the planner can neither see an undeclared value nor change a
 * declared one for anything that runs after it.
 *
 * `defineAdapter` applies this to every capability call before the
 * capability's own planner runs. It is exported for adapters assembled
 * without the factory, which owe their callers the same refusal.
 */
export function checkPlanningContext(value: unknown, declarations: CapabilityDeclarations): CheckPlanningContextResult {
  try {
    return checkContext(value, declarations)
  } catch {
    // A getter or proxy on caller-supplied input threw. Whatever it would
    // have produced, it is not a readable context.
    return invalid('context', 'could not be read')
  }
}

function checkContext(value: unknown, declarations: CapabilityDeclarations): CheckPlanningContextResult {
  if (!isRecord(value)) return invalid('context', 'must be a planning context object')

  const target = value.target
  if (!isRecord(target)) return invalid('context.target', 'must be an installation target object')

  const scope = target.scope
  if (typeof scope !== 'string') return invalid('context.target.scope', 'must be "project" or "user"')
  if (!isInstallationScope(scope)) {
    return { ok: false, failure: { code: 'unsupported-scope', scope, supportedScopes: declarations.supportedScopes } }
  }

  let checkedTarget: InstallationTarget
  if (scope === 'project') {
    const projectRoot = target.projectRoot
    if (typeof projectRoot !== 'string' || !isAbsoluteLocation(projectRoot)) {
      return invalid('context.target.projectRoot', 'a project target must carry an absolute project root')
    }
    checkedTarget = Object.freeze({ scope, projectRoot })
  } else {
    if (Object.hasOwn(target, 'projectRoot')) {
      return invalid('context.target.projectRoot', 'a user target must not carry a project root')
    }
    checkedTarget = Object.freeze({ scope })
  }

  const homeDirectory = value.homeDirectory
  if (typeof homeDirectory !== 'string' || !isAbsoluteLocation(homeDirectory)) {
    return invalid('context.homeDirectory', 'must be an absolute path')
  }

  const environment = value.environment
  if (!isRecord(environment)) return invalid('context.environment', 'must be an object of environment values')
  const visible: Record<string, string> = {}
  for (const name of declarations.locationEnvironment) {
    if (!Object.hasOwn(environment, name)) continue
    const entry = environment[name]
    if (entry === undefined) continue
    if (typeof entry !== 'string') return invalid(`context.environment.${name}`, 'must be a string or undefined')
    // Defined rather than assigned: a declared name is grammar-checked, but a
    // plain assignment is still the wrong primitive for building a map.
    Object.defineProperty(visible, name, { value: entry, enumerable: true, writable: false, configurable: false })
  }

  if (!declarations.supportedScopes.includes(scope)) {
    return { ok: false, failure: { code: 'unsupported-scope', scope, supportedScopes: declarations.supportedScopes } }
  }

  return {
    ok: true,
    context: Object.freeze({ target: checkedTarget, homeDirectory, environment: Object.freeze(visible) }),
  }
}
