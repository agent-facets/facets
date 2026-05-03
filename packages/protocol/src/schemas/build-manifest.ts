import { type } from 'arktype'

/**
 * Schema for the build manifest (build-manifest.json).
 * Written by `facet build` alongside the .facet archive.
 */
export const BuildManifestSchema = type({
  facetVersion: 'number',
  archive: 'string',
  integrity: /^sha256:[a-f0-9]{64}$/,
  assets: type.Record('string', 'string'),
})

/** Inferred TypeScript type for a validated build manifest */
export type BuildManifest = typeof BuildManifestSchema.infer
