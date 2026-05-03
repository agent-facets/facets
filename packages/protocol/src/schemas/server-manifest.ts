import { type } from 'arktype'

/**
 * Schema for the server manifest (server.json).
 * Matches the shape defined in ADR-005.
 */
export const ServerManifestSchema = type({
  name: 'string',
  version: 'string',
  runtime: 'string',
  entry: 'string',
  'description?': 'string',
  'author?': 'string',
})

/** Inferred TypeScript type for a validated server manifest */
export type ServerManifest = typeof ServerManifestSchema.infer
