import { type } from 'arktype'

/** Facet identity section of the lockfile */
const LockfileFacet = type({
  name: 'string',
  version: 'string',
  integrity: 'string',
})

/** Source-mode server entry — resolved from the facets registry */
const SourceModeServerEntry = type({
  version: 'string',
  integrity: 'string',
  api_surface: 'string',
})

/** Ref-mode server entry — resolved from an OCI registry */
const RefModeServerEntry = type({
  image: 'string',
  digest: 'string',
  api_surface: 'string',
})

/** A lockfile server entry is either source-mode or ref-mode */
const ServerEntry = SourceModeServerEntry.or(RefModeServerEntry)

/**
 * Schema for facets.lock — the lockfile recording resolved installation state.
 * Matches the shape defined in [ADR-3](https://www.notion.so/exmachina-co/ADR-3).
 */
export const LockfileSchema = type({
  facet: LockfileFacet,
  'servers?': type.Record('string', ServerEntry),
})

/** Inferred TypeScript type for a validated lockfile */
export type Lockfile = typeof LockfileSchema.infer
