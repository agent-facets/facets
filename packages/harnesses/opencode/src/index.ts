import { defineHarness } from '@agent-facets/harness'
import { type } from 'arktype'

/** OpenCode per-asset metadata schema */
const OpenCodeMetadataSchema = type({
  'tools?': 'Record<string, boolean>',
  'model?': 'string',
  'permissions?': 'Record<string, "allow" | "deny">',
})

/**
 * OpenCode adapter — defines the conventions for OpenCode,
 * an AI coding tool built on top of LLMs.
 */
export default defineHarness({
  name: 'opencode',

  buildAssetMetadata(data) {
    const result = OpenCodeMetadataSchema(data)
    if (result instanceof type.errors) {
      return {
        ok: false,
        errors: result.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          expected: err.expected ?? 'unknown',
          actual: String(err.actual ?? 'unknown'),
        })),
      }
    }
    return { ok: true, data: result as Record<string, unknown> }
  },

  async installAsset() {},
  async readAsset() {
    return { content: 'Your asset sir...' }
  },
  async deleteAsset() {},
})
