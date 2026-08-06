import { SUPPORTED_ADAPTER_APIS } from '@agent-facets/engine'
import authoring from './authoring.txt' with { type: 'text' }
import manifest from './manifest.txt' with { type: 'text' }
import overview from './overview.txt' with { type: 'text' }
import usage from './usage.txt' with { type: 'text' }

/**
 * One typed record per instruction topic: its prompt body and a one-line
 * summary. This is the single source of truth for the topic set — the valid
 * topic list, the unknown-topic error, the `fix:` invocation, and the topic
 * index rendered at the top of the overview all derive from it, so a new topic
 * cannot drift out of any of them.
 */
type TopicMeta = {
  /** The full instruction text printed for this topic. */
  prompt: string
  /** One-line summary shown in the overview's topic index. */
  summary: string
}

/**
 * The instruction topics an agent can request via `facet instructions [topic]`.
 * Declaration order is the display order in the overview index; `overview`
 * comes first so the default topic heads its own index.
 */
export const TOPICS = {
  overview: {
    prompt: overview,
    summary: 'Overview and topic index (default; `facet instructions` is equivalent).',
  },
  manifest: {
    prompt: manifest,
    summary: 'facet.json fields and the generated JSON Schema.',
  },
  authoring: {
    prompt: authoring,
    summary: 'Scaffold, change, and verify a facet non-interactively.',
  },
  usage: {
    prompt: usage,
    summary: 'Manage facets and adapter tooling in a project.',
  },
} as const satisfies Record<string, TopicMeta>

export type InstructionTopic = keyof typeof TOPICS

export const DEFAULT_TOPIC: InstructionTopic = 'overview'

export const INSTRUCTION_TOPICS = Object.keys(TOPICS) as InstructionTopic[]

export function isInstructionTopic(value: string): value is InstructionTopic {
  return value in TOPICS
}

/**
 * The marker in `overview.txt` where the generated topic index is injected.
 * Keeping the index generated (rather than hand-listed in the prompt) means
 * the topic set and its summaries live in exactly one place — {@link TOPICS}.
 */
export const OVERVIEW_INDEX_MARKER = '{{TOPIC_INDEX}}'

/**
 * The marker in `usage.txt` where the CLI's adapter API support set is
 * injected. Generated for the same reason as the topic index: the window is
 * declared once, in engine's `SUPPORTED_ADAPTER_APIS`, and prose that restated
 * it would silently go stale the next time the set changes.
 */
export const ADAPTER_API_SUPPORT_SET_MARKER = '{{ADAPTER_API_SUPPORT_SET}}'

/** Render the support set as prose: `0.1`, or `0.1 and 0.2`, or `a, b, and c`. */
export function renderAdapterApiSupportSet(): string {
  const apis = [...SUPPORTED_ADAPTER_APIS]
  if (apis.length <= 1) return apis.join('')
  if (apis.length === 2) return apis.join(' and ')
  return `${apis.slice(0, -1).join(', ')}, and ${apis.at(-1)}`
}

/**
 * Render the topic index block injected into the overview. Each line is the
 * exact invocation an agent would run, padded to a shared column, followed by
 * the topic's summary — so the overview always advertises every topic the CLI
 * actually serves.
 */
export function renderTopicIndex(): string {
  const rows = INSTRUCTION_TOPICS.map((topic) => ({
    invocation: `facet instructions ${topic}`,
    summary: TOPICS[topic].summary,
  }))
  const width = Math.max(...rows.map((row) => row.invocation.length))
  const lines = rows.map((row) => `  ${row.invocation.padEnd(width)}  ${row.summary}`)
  return `Instruction topics\n${lines.join('\n')}`
}

/**
 * The full instruction text for a topic. For `overview`, the generated topic
 * index is substituted at {@link OVERVIEW_INDEX_MARKER}; other topics are
 * returned verbatim.
 */
export function promptFor(topic: InstructionTopic): string {
  const body = TOPICS[topic].prompt
  if (topic === 'overview') return body.replace(OVERVIEW_INDEX_MARKER, renderTopicIndex())
  if (topic === 'usage') return body.replace(ADAPTER_API_SUPPORT_SET_MARKER, renderAdapterApiSupportSet())
  return body
}
