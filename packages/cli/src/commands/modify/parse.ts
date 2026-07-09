import type { AssetTarget, FacetMetaFields, FieldMutation, ModifyOp } from '@agent-facets/engine'
import { isValidKebabCase } from '@agent-facets/engine'
import type { CliError } from '../../util/errors.ts'

/**
 * The result of narrowing raw CLI input into a modify operation. Every illegal
 * flag combination is rejected here so the engine's `applyModify` only ever
 * sees a well-formed `ModifyOp`.
 */
export type ParseModifyResult = { ok: true; op: ModifyOp } | { ok: false; error: CliError }

const ASSET_TARGETS: Record<string, AssetTarget> = {
  skill: 'skills',
  agent: 'agents',
  command: 'commands',
}

const ADAPTER_PREFIX = 'adapter-'
const REMOVE_ADAPTER_PREFIX = 'remove-adapter-'

/**
 * Parse `facet modify <target> <name>` positionals plus the flag bag into a
 * validated `ModifyOp`.
 *
 * Rules enforced here (the single funnel for all pairing constraints):
 * - `<target>` must be skill | agent | command | facet.
 * - Asset targets: at most one lifecycle verb (--add / --remove / --rename).
 *   Field setters (--description, adapter mutations) may accompany add/rename
 *   or stand alone as an `update`. `--remove` forbids any field setter. No
 *   verb and no setter is a no-op → error.
 * - `facet` target: only --name/--description/--version/--private (≥1).
 */
export function parseModifyArgs(positionals: string[], flags: Record<string, unknown>): ParseModifyResult {
  const target = positionals[0]
  if (!target) {
    return err(
      'missing target',
      'facet modify requires a target',
      'use: facet modify <skill|agent|command|facet> [name] [flags]',
    )
  }

  if (target === 'facet') {
    return parseFacetMeta(flags)
  }

  const assetTarget = ASSET_TARGETS[target]
  if (!assetTarget) {
    return err(
      `unknown target "${target}"`,
      'target must be skill, agent, command, or facet',
      'use: facet modify <skill|agent|command|facet> [name] [flags]',
    )
  }

  const name = positionals[1]
  if (!name) {
    return err(
      `missing ${target} name`,
      `facet modify ${target} requires a name`,
      `use: facet modify ${target} <name> [flags]`,
    )
  }

  // Reject facet-meta flags on an asset target.
  for (const metaFlag of ['name', 'version', 'private'] as const) {
    if (flags[metaFlag] !== undefined) {
      return err(
        `--${metaFlag} is not valid for a ${target}`,
        `--${metaFlag} applies to the facet target only`,
        `use: facet modify facet --${metaFlag} ... (or drop --${metaFlag})`,
      )
    }
  }

  // Collect field mutations from the flag bag.
  const mutations: FieldMutation[] = []
  if (typeof flags.description === 'string') {
    mutations.push({ field: 'description', value: flags.description })
  }
  const adapterResult = collectAdapterMutations(flags)
  if (!adapterResult.ok) return adapterResult
  mutations.push(...adapterResult.mutations)

  // Count lifecycle verbs.
  const hasAdd = flags.add === true
  const hasRemove = flags.remove === true
  const renameTo = typeof flags.rename === 'string' ? flags.rename : undefined
  const verbCount = (hasAdd ? 1 : 0) + (hasRemove ? 1 : 0) + (renameTo !== undefined ? 1 : 0)

  if (verbCount > 1) {
    return err(
      'conflicting operations',
      'choose exactly one of --add, --remove, or --rename',
      'run one operation per invocation',
    )
  }

  if (hasRemove) {
    if (mutations.length > 0) {
      return err(
        'cannot modify fields while removing',
        '--remove takes no --description or adapter flags',
        'remove the asset in one call, then set fields in another',
      )
    }
    return { ok: true, op: { kind: 'remove', target: assetTarget, name } }
  }

  if (renameTo !== undefined) {
    if (!isValidKebabCase(renameTo)) {
      return err(
        `invalid rename target "${renameTo}"`,
        'asset names must be kebab-case',
        'pass a name like --rename my-asset',
      )
    }
    return { ok: true, op: { kind: 'rename', target: assetTarget, name, to: renameTo, mutations } }
  }

  if (hasAdd) {
    return { ok: true, op: { kind: 'add', target: assetTarget, name, mutations } }
  }

  // No lifecycle verb — this is an update, which needs at least one mutation.
  if (mutations.length === 0) {
    return err(
      'no operation specified',
      'nothing to change — pass --add, --remove, --rename, --description, or an adapter flag',
      'e.g. facet modify skill greet --description "..."',
    )
  }

  return { ok: true, op: { kind: 'update', target: assetTarget, name, mutations } }
}

/** Parse `facet modify facet` metadata flags into a set-facet-meta op. */
function parseFacetMeta(flags: Record<string, unknown>): ParseModifyResult {
  // Reject asset lifecycle flags on the facet target.
  for (const assetFlag of ['add', 'remove', 'rename'] as const) {
    if (flags[assetFlag] !== undefined) {
      return err(
        `--${assetFlag} is not valid for the facet target`,
        'the facet target only sets metadata',
        'use: facet modify facet --name/--description/--version/--private',
      )
    }
  }

  const fields: FacetMetaFields = {}
  if (typeof flags.name === 'string') fields.name = flags.name
  if (typeof flags.description === 'string') fields.description = flags.description
  if (typeof flags.version === 'string') fields.version = flags.version
  if (flags.private !== undefined) fields.private = flags.private === true

  if (Object.keys(fields).length === 0) {
    return err(
      'no facet fields to set',
      'pass at least one of --name, --description, --version, or --private',
      'e.g. facet modify facet --version 1.0.0',
    )
  }

  return { ok: true, op: { kind: 'set-facet-meta', fields } }
}

/**
 * Extract `--adapter-<name> '<json>'` and `--remove-adapter-<name>` flags from
 * the bag. The adapter name is the whole suffix after the prefix, so
 * hyphenated names like `claude-code` work. Each set flag's value must be a
 * JSON object.
 */
function collectAdapterMutations(
  flags: Record<string, unknown>,
): { ok: true; mutations: FieldMutation[] } | { ok: false; error: CliError } {
  const mutations: FieldMutation[] = []
  for (const [key, value] of Object.entries(flags)) {
    if (key.startsWith(REMOVE_ADAPTER_PREFIX)) {
      const adapter = key.slice(REMOVE_ADAPTER_PREFIX.length)
      if (adapter.length === 0) continue
      mutations.push({ field: 'remove-adapter', adapter })
      continue
    }
    if (key.startsWith(ADAPTER_PREFIX)) {
      const adapter = key.slice(ADAPTER_PREFIX.length)
      if (adapter.length === 0) continue
      if (typeof value !== 'string') {
        return {
          ok: false,
          error: err(
            `missing JSON for --adapter-${adapter}`,
            'this flag expects a JSON object value',
            `pass: --adapter-${adapter} '{ ... }'`,
          ).error,
        }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        return {
          ok: false,
          error: err(
            `invalid JSON for --adapter-${adapter}`,
            'the value could not be parsed as JSON',
            `pass valid JSON, e.g. --adapter-${adapter} '{"key":"value"}'`,
          ).error,
        }
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {
          ok: false,
          error: err(
            `--adapter-${adapter} must be a JSON object`,
            'adapter config must be an object',
            `pass an object, e.g. --adapter-${adapter} '{"key":"value"}'`,
          ).error,
        }
      }
      mutations.push({ field: 'adapter', adapter, config: parsed as Record<string, unknown> })
    }
  }
  return { ok: true, mutations }
}

function err(what: string, detail: string, fix: string): { ok: false; error: CliError } {
  return { ok: false, error: { what, detail, fix } }
}
