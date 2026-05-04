import { type } from 'arktype'

/**
 * Schema for facets.json — the project-level manifest declaring which
 * facets the project depends on.
 *
 * The map value is the source specifier as the user wrote it (git-ref,
 * git+, file:, or shortcut form). Validation of specifier grammar happens
 * at install time in parse-source; the schema only guarantees the shape.
 */
export const FacetsJsonSchema = type({
  facets: type.Record('string', 'string'),
})

/** Inferred TypeScript type for a validated facets.json */
export type FacetsJson = typeof FacetsJsonSchema.infer
