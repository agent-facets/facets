import { type AdvancingChoices, type ExactVersion, parseVersionSpec, type UpdatePlanRow } from '@agent-facets/engine'

/**
 * Plan rows for the CLI's own tests.
 *
 * The engine builds these from real registry answers; everything here
 * only needs them to be well-formed, so versions are parsed rather than
 * hand-shaped and the specifier goes through the real grammar.
 */
export function exact(version: string): ExactVersion {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return { kind: 'exact', major, minor, patch }
}

function choice(name: string, version: string) {
  return {
    version: exact(version),
    metadata: {
      name,
      version,
      transportHash: `transport-${name}-${version}`,
      contentFingerprint: `content-${name}-${version}`,
    },
  }
}

function authored(source: string) {
  const spec = parseVersionSpec(source)
  if (!spec.ok) throw new Error(`test fixture declares an invalid specifier: ${source}`)
  return { source, spec: spec.value }
}

export function candidate(args: {
  name: string
  source: string
  current: string
  target: string
  latest: string
  advancing: AdvancingChoices
}): Extract<UpdatePlanRow, { kind: 'candidate' }> {
  return {
    kind: 'candidate',
    advancing: args.advancing,
    facet: {
      name: args.name,
      authored: authored(args.source),
      current: exact(args.current),
      target: choice(args.name, args.target),
      latest: choice(args.name, args.latest),
    },
  }
}

export function current(args: {
  name: string
  source: string
  version: string
}): Extract<UpdatePlanRow, { kind: 'current' }> {
  return {
    kind: 'current',
    facet: {
      name: args.name,
      authored: authored(args.source),
      current: exact(args.version),
      target: choice(args.name, args.version),
      latest: choice(args.name, args.version),
    },
  }
}

export function unsupported(name: string, source: string, sourceKind: 'git' | 'local'): UpdatePlanRow {
  return { kind: 'unsupported-source', name, source, sourceKind }
}
