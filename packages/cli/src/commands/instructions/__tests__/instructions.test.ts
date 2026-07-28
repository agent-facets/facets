import { describe, expect, test } from 'bun:test'
import { FacetManifestSchema } from '@agent-facets/protocol'
import {
  DEFAULT_TOPIC,
  INSTRUCTION_TOPICS,
  isInstructionTopic,
  promptFor,
  renderTopicIndex,
  TOPICS,
} from '../../../prompts/index.ts'
import { instructionsCommand } from '../index.ts'

describe('instruction topics', () => {
  test('default topic is overview and has a non-empty prompt', () => {
    expect(DEFAULT_TOPIC).toBe('overview')
    expect(TOPICS.overview.prompt.length).toBeGreaterThan(0)
  })

  test('all four domain topics exist with a prompt and a summary', () => {
    expect(INSTRUCTION_TOPICS.sort()).toEqual(['authoring', 'manifest', 'overview', 'usage'])
    for (const topic of INSTRUCTION_TOPICS) {
      expect(TOPICS[topic].prompt.length).toBeGreaterThan(0)
      expect(TOPICS[topic].summary.length).toBeGreaterThan(0)
    }
  })

  test('isInstructionTopic narrows valid and rejects invalid', () => {
    expect(isInstructionTopic('authoring')).toBe(true)
    expect(isInstructionTopic('nope')).toBe(false)
  })
})

describe('topic index', () => {
  test('renders one line per topic, each with its invocation and summary', () => {
    const index = renderTopicIndex()
    expect(index).toContain('Instruction topics')
    for (const topic of INSTRUCTION_TOPICS) {
      expect(index).toContain(`facet instructions ${topic}`)
      expect(index).toContain(TOPICS[topic].summary)
    }
  })

  test('overview prompt substitutes the generated index before workflow routing', () => {
    const overview = promptFor('overview')
    // The marker must be replaced, not printed literally.
    expect(overview).not.toContain('{{TOPIC_INDEX}}')
    // Every topic is listed, and the index precedes the AUTHORING/USING routing.
    for (const topic of INSTRUCTION_TOPICS) {
      expect(overview).toContain(`facet instructions ${topic}`)
    }
    expect(overview.indexOf('Instruction topics')).toBeLessThan(overview.indexOf('AUTHORING a facet'))
  })

  test('non-overview prompts are returned verbatim (no marker substitution)', () => {
    for (const topic of INSTRUCTION_TOPICS) {
      if (topic === 'overview') continue
      expect(promptFor(topic)).toBe(TOPICS[topic].prompt)
    }
  })
})

describe('0.29 guidance is present in the prompts', () => {
  test('authoring covers README default, --no-readme, top-level files, and verify', () => {
    const authoring = TOPICS.authoring.prompt
    expect(authoring).toContain('README.md')
    expect(authoring).toContain('--no-readme')
    expect(authoring).toContain('"files"')
    expect(authoring).toContain('facet build --verify')
  })

  test('manifest documents top-level and per-skill supplementary files', () => {
    const manifest = TOPICS.manifest.prompt
    expect(manifest).toContain('files')
    expect(manifest).toContain('archive-only')
    expect(manifest).toContain('companion')
    // The generated-schema marker must be preserved for the append step.
    expect(manifest).toContain('--- JSON Schema (generated) ---')
  })

  test('usage covers adapter API 0.1 recovery guidance', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('adapter API 0.1')
    expect(usage).toContain('facet adapter list')
  })
})

describe('materialization guidance is present in the prompts', () => {
  // An agent that believes facets.json is a flat name -> string map will
  // silently destroy any recorded alias or omission the moment it rewrites
  // the file. The prompt is the only thing standing between that belief and
  // a user's project, so assert it teaches both entry forms.
  test('usage documents the expanded facets.json entry form', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('manifestVersion')
    expect(usage).toContain('"materialization"')
    expect(usage).toContain('handle BOTH forms')
  })

  test('usage teaches the non-TTY collision remedy', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('"kind": "aliased"')
    expect(usage).toContain('"kind": "omitted"')
    // Recording an explicit authored disposition is rejected by the schema,
    // so the prompt must not present it as an option.
    expect(usage).toContain('Do NOT write')
    expect(usage).toContain('"skills", "agents", and "commands"')
  })

  test('usage does not claim facets.json is a flat string map', () => {
    expect(TOPICS.usage.prompt).not.toContain('map of facet name to source specifier')
  })

  test('usage does not steer agents away from the only non-TTY remedy', () => {
    // Hand-editing facets.json is the sole way to record an alias without a
    // TTY -- there is no --as or --omit flag on any command.
    expect(TOPICS.usage.prompt).not.toContain('You generally do not hand-edit it')
  })

  test('authoring warns that authored names may not land verbatim', () => {
    const authoring = TOPICS.authoring.prompt
    expect(authoring).toContain('AUTHORED name')
    expect(authoring).toContain('omit it entirely')
  })

  test('overview command index covers the project-management commands', () => {
    const overview = TOPICS.overview.prompt
    for (const command of ['facet install', 'facet remove', 'facet list', 'facet publish']) {
      expect(overview).toContain(command)
    }
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
