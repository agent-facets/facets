import { FacetManifestSchema } from '@agent-facets/protocol'
import type { Command } from '../../commands.ts'
import { DEFAULT_TOPIC, INSTRUCTION_TOPICS, isInstructionTopic, promptFor } from '../../prompts/index.ts'
import { writeCliError } from '../../util/errors.ts'

/**
 * `facet instructions [topic]` — print agent-oriented usage instructions.
 *
 * This command is FOR AI AGENTS. The prompts are curated workflow guidance
 * (not per-flag help) that tell an autonomous agent how to author and use
 * facets. The overview (default) opens with a generated index of every topic;
 * topics: overview (default), manifest, authoring, usage.
 */
export const instructionsCommand: Command = {
  name: 'instructions',
  description: 'Print CLI usage instructions FOR AI AGENTS',
  usage: '[topic]',
  implemented: true,
  run: async (args: string[]): Promise<number> => {
    const topic = args[0] ?? DEFAULT_TOPIC

    if (!isInstructionTopic(topic)) {
      writeCliError({
        what: `unknown instructions topic "${topic}"`,
        detail: `valid topics: ${INSTRUCTION_TOPICS.join(', ')}`,
        fix: `run: facet instructions [${INSTRUCTION_TOPICS.join('|')}]`,
      })
      return 1
    }

    const prompt = promptFor(topic)
    process.stdout.write(prompt)
    if (!prompt.endsWith('\n')) process.stdout.write('\n')

    // The manifest topic appends the JSON Schema generated live from the
    // protocol arktype schema — a single source of truth, never hand-copied.
    // The `.narrow()` business-rule predicate can't be represented in JSON
    // Schema; the `fallback` keeps the structural schema and drops the
    // predicate rather than throwing.
    if (topic === 'manifest') {
      const jsonSchema = FacetManifestSchema.toJsonSchema({
        fallback: { predicate: (ctx) => ctx.base },
      })
      process.stdout.write(`${JSON.stringify(jsonSchema, null, 2)}\n`)
    }

    return 0
  },
}
