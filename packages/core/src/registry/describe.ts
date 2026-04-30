import type { VersionSpec } from '../sources/index.ts'

/**
 * Render a `VersionSpec` as the surface form a user would type. Used
 * in error messages so the rejection cites the spec the user wrote.
 */
export function describeVersionSpec(spec: VersionSpec): string {
  switch (spec.kind) {
    case 'exact':
      return `${spec.major}.${spec.minor}.${spec.patch}`
    case 'majorWildcard':
      return `${spec.major}.*`
    case 'minorWildcard':
      return `${spec.major}.${spec.minor}.*`
    case 'wildcard':
      return '*'
    case 'latest':
      return 'latest'
  }
}
