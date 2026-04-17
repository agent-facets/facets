import { defineHarness } from '@agent-facets/harness'
import { type } from 'arktype'

/** Claude Code per-asset metadata schema */
const ClaudeCodeMetadataSchema = type({
  'tools?': type.Record('string', 'boolean'),
  'permissions?': type.Record('string', 'boolean'),
})

/**
 * Claude Code harness — defines the conventions for Claude Code,
 * Anthropic's AI coding tool.
 */
export default defineHarness({
  name: 'claude-code',

  buildAssetMetadata(data) {
    const result = ClaudeCodeMetadataSchema(data)

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
