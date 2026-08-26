import {
  type AuthoredSpecifier,
  type ExactVersion,
  parseVersionSpec,
  type TargetVersion,
  type UpdatePlanRow,
} from '@agent-facets/engine'

/**
 * Plan rows for the CLI's own tests.
 *
 * The engine builds these from real registry answers; everything here
 * only needs them to be well-formed, so every version and specifier goes
 * through the real grammar rather than being hand-shaped. A malformed
 * fixture is a thrown test-setup error, not a silent `0.0.0`.
 *
 * Which columns advance is deliberately NOT a parameter. It is derived
 * from the versions by the same engine predicate the picker and
 * application use, so a fixture cannot describe a row the engine could
 * not produce.
 */
export function exact(version: string): ExactVersion {
  const spec = parseVersionSpec(version)
  if (!spec.ok || spec.value.kind !== 'exact') {
    throw new Error(`test fixture declares an invalid exact version: ${version}`)
  }
  return spec.value
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

function authored(source: string): AuthoredSpecifier {
  const spec = parseVersionSpec(source)
  if (!spec.ok) throw new Error(`test fixture declares an invalid specifier: ${source}`)
  return { source, spec: spec.value }
}

/**
 * An exact specifier's Target is the pin itself, and discovery never
 * asks the registry for it — so the fixture carries no metadata either.
 */
function target(name: string, declared: AuthoredSpecifier, version: string): TargetVersion {
  if (declared.spec.kind === 'exact') return { kind: 'pinned', version: exact(version) }
  return { kind: 'resolved', ...choice(name, version) }
}

export function candidate(args: {
  name: string
  source: string
  current: string
  target: string
  latest: string
}): Extract<UpdatePlanRow, { kind: 'candidate' }> {
  const declared = authored(args.source)
  return {
    kind: 'candidate',
    facet: {
      name: args.name,
      authored: declared,
      current: exact(args.current),
      target: target(args.name, declared, args.target),
      latest: choice(args.name, args.latest),
    },
  }
}

export function current(args: {
  name: string
  source: string
  version: string
}): Extract<UpdatePlanRow, { kind: 'current' }> {
  const declared = authored(args.source)
  return {
    kind: 'current',
    facet: {
      name: args.name,
      authored: declared,
      current: exact(args.version),
      target: target(args.name, declared, args.version),
      latest: choice(args.name, args.version),
    },
  }
}

export function unsupported(name: string, source: string, sourceKind: 'git' | 'local'): UpdatePlanRow {
  return { kind: 'unsupported-source', name, source, sourceKind }
}
