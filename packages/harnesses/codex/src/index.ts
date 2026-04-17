import { defineHarness } from '@agent-facets/harness'

/**
 * Codex harness — defines the conventions for Codex,
 * OpenAI's CLI coding agent.
 *
 * Codex has minimal structured metadata conventions,
 * so buildAssetMetadata accepts any record as valid.
 */
export default defineHarness({
  name: 'codex',

  buildAssetMetadata(data) {
    // Codex has no structured metadata schema — accept any record
    if (data !== null && data !== undefined && typeof data === 'object' && !Array.isArray(data)) {
      return { ok: true, data: data as Record<string, unknown> }
    }
    // If data is null/undefined, treat as empty metadata
    if (data === null || data === undefined) {
      return { ok: true, data: {} }
    }
    return {
      ok: false,
      errors: [
        {
          path: '',
          message: 'Codex metadata must be an object',
          expected: 'object',
          actual: typeof data,
        },
      ],
    }
  },

  async installAsset() {},
  async readAsset() {
    return { content: 'Your asset sir...' }
  },
  async deleteAsset() {},
})
