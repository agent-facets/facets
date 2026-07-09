import authoring from './authoring.txt' with { type: 'text' }
import manifest from './manifest.txt' with { type: 'text' }
import overview from './overview.txt' with { type: 'text' }
import usage from './usage.txt' with { type: 'text' }

/**
 * The instruction topics an agent can request via `facet instructions [topic]`.
 * The keys are the source of truth for the valid-topic list; the command and
 * its error message both derive from `INSTRUCTION_TOPICS`.
 */
export const PROMPTS = {
  overview,
  manifest,
  authoring,
  usage,
} as const

export type InstructionTopic = keyof typeof PROMPTS

export const DEFAULT_TOPIC: InstructionTopic = 'overview'

export const INSTRUCTION_TOPICS = Object.keys(PROMPTS) as InstructionTopic[]

export function isInstructionTopic(value: string): value is InstructionTopic {
  return value in PROMPTS
}
