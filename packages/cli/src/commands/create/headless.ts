import { DEFAULT_VERSION, isValidSemVer, type ScaffoldOptions } from '@agent-facets/engine'
import { validateAssetNameSegment, validateFacetName } from '@agent-facets/protocol'
import type { CliError } from '../../util/errors.ts'

/**
 * The create command routes on one tagged decision derived from the raw flag
 * bag. Either the user gave no headless flags (run the interactive wizard) or
 * they gave at least one (run headless with a fully-validated ScaffoldOptions).
 * Illegal partial states — e.g. `--skill x` with no `--name` — are rejected at
 * this boundary and never reach the scaffold machinery.
 */
export type CreateDecision =
  | { mode: 'wizard' }
  | { mode: 'headless'; options: ScaffoldOptions }
  | { mode: 'error'; error: CliError }

/** The flag names that, when present, trigger headless (non-wizard) create. */
const HEADLESS_FLAGS = ['name', 'description', 'version', 'private', 'skill', 'agent', 'command'] as const

/**
 * Narrow the raw create flag bag into a CreateDecision. `--force` and `--json`
 * are presentation flags, not content flags, so they do NOT by themselves
 * trigger headless mode — only the flags in HEADLESS_FLAGS do.
 */
export function decideCreate(flags: Record<string, unknown>): CreateDecision {
  const anyHeadless = HEADLESS_FLAGS.some((f) => flags[f] !== undefined)
  if (!anyHeadless) return { mode: 'wizard' }

  const name = typeof flags.name === 'string' ? flags.name : undefined
  if (name === undefined || name.length === 0) {
    return {
      mode: 'error',
      error: {
        what: 'missing --name',
        detail: 'headless create requires a facet name',
        fix: 'pass --name <name> (e.g. facet create --name my-facet --skill greet)',
      },
    }
  }

  const nameCheck = validateFacetName(name)
  if (!nameCheck.ok) {
    return {
      mode: 'error',
      error: {
        what: `invalid facet name "${name}"`,
        detail: nameCheck.reason,
        fix: 'use an unscoped slug (my-facet) or a scoped name (@scope/my-facet)',
      },
    }
  }

  const version = typeof flags.version === 'string' ? flags.version : DEFAULT_VERSION
  if (!isValidSemVer(version)) {
    return {
      mode: 'error',
      error: {
        what: `invalid --version "${version}"`,
        detail: 'version must be semver (MAJOR.MINOR.PATCH)',
        fix: 'pass a version like --version 0.1.0',
      },
    }
  }

  const description = typeof flags.description === 'string' ? flags.description : ''

  const skills = asStringArray(flags.skill)
  const agents = asStringArray(flags.agent)
  const commands = asStringArray(flags.command)

  for (const [group, names] of [
    ['skill', skills],
    ['agent', agents],
    ['command', commands],
  ] as const) {
    for (const assetName of names) {
      const check = validateAssetNameSegment(assetName)
      if (!check.ok) {
        return {
          mode: 'error',
          error: {
            what: `invalid ${group} name "${assetName}"`,
            detail: `asset name ${check.reason}`,
            fix: `pass a valid name, e.g. --${group} my-${group}`,
          },
        }
      }
    }
  }

  if (skills.length === 0 && agents.length === 0 && commands.length === 0) {
    return {
      mode: 'error',
      error: {
        what: 'no assets to scaffold',
        detail: 'a facet must declare at least one skill, agent, or command',
        fix: 'pass at least one of --skill, --agent, or --command',
      },
    }
  }

  const options: ScaffoldOptions = {
    name,
    version,
    description,
    skills,
    agents,
    commands,
    ...(flags.private === true ? { private: true as const } : {}),
  }

  return { mode: 'headless', options }
}

/** Array flags surface as `string[]` from run.ts; treat anything else as empty. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}
