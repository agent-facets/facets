import { describe, expect, test } from 'bun:test'
import { FacetManifestSchema } from '@agent-facets/protocol'
import { DEFAULT_TOPIC, INSTRUCTION_TOPICS, isInstructionTopic, PROMPTS } from '../../../prompts/index.ts'
import { instructionsCommand } from '../index.ts'

describe('instruction topics', () => {
  test('default topic is overview and is present', () => {
    expect(DEFAULT_TOPIC).toBe('overview')
    expect(PROMPTS.overview.length).toBeGreaterThan(0)
  })

  test('all four domain topics exist and are non-empty', () => {
    expect(INSTRUCTION_TOPICS.sort()).toEqual(['authoring', 'manifest', 'overview', 'usage'])
    for (const topic of INSTRUCTION_TOPICS) {
      expect(PROMPTS[topic].length).toBeGreaterThan(0)
    }
  })

  test('isInstructionTopic narrows valid and rejects invalid', () => {
    expect(isInstructionTopic('authoring')).toBe(true)
    expect(isInstructionTopic('nope')).toBe(false)
  })
})

describe('manifest schema generation', () => {
  test('toJsonSchema with the predicate fallback does not throw and drops the predicate', () => {
    let schema: unknown
    expect(() => {
      schema = FacetManifestSchema.toJsonSchema({ fallback: { predicate: (ctx) => ctx.base } })
    }).not.toThrow()
    expect(JSON.stringify(schema)).not.toContain('predicate')
    const obj = schema as { required?: string[] }
    expect(obj.required).toContain('name')
    expect(obj.required).toContain('version')
  })
})

describe('instructionsCommand.run', () => {
  test('unknown topic returns exit code 1', async () => {
    const code = await instructionsCommand.run(['bogus'], {})
    expect(code).toBe(1)
  })

  test('known topic returns 0', async () => {
    const code = await instructionsCommand.run(['authoring'], {})
    expect(code).toBe(0)
  })

  test('no topic (default overview) returns 0', async () => {
    const code = await instructionsCommand.run([], {})
    expect(code).toBe(0)
  })
})
