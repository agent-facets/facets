import type { ReactNode } from 'react'

/**
 * Single source of truth for the "So what's a facet?" primitive copy.
 * Shared between the desktop `FacetStage` (scroll-linked) and the
 * mobile `MobileFacetStack` (static).
 *
 * STEPS describes the 5 scroll-choreographed steps on desktop. The
 * final step (`05 / The Facet`) is the "packed" summary, which on
 * mobile is rendered separately in the `.packed` card and uses the
 * copy from PACKED_COPY below.
 */
export type StepCopy = {
  readonly idx: string
  readonly title: ReactNode
  readonly body: ReactNode
  readonly tags: readonly string[]
}

/**
 * Mobile primitive-card metadata — the 4 colored cards shown in
 * `MobileFacetStack`. Derived from the same source as STEPS but
 * adds an `accent` slot so the card can style its top border
 * without introspecting className conventions.
 */
export type PrimitiveCardCopy = {
  readonly num: string
  readonly slug: 'skills' | 'agents' | 'cmds' | 'mcp'
  readonly badge: string
  readonly title: ReactNode
  readonly body: string
  readonly tags: readonly string[]
}

export const STEPS: readonly StepCopy[] = [
  {
    idx: '01 / Skills',
    title: (
      <>
        Procedural <em>know-how.</em>
      </>
    ),
    body: 'Structured recipes your agent can follow — from "write a PR description" to "run a TPM standup." Curated, tested, versioned.',
    tags: ['markdown', 'deterministic', 'composable'],
  },
  {
    idx: '02 / Agents',
    title: (
      <>
        Specialists on <em>call.</em>
      </>
    ),
    body: 'Sub-agents with their own system prompts, tool budgets, and personalities. Spawn them when you need a second opinion, a reviewer, or a planner.',
    tags: ['sub-agent', 'scoped tools', 'memory'],
  },
  {
    idx: '03 / Commands',
    title: (
      <>
        Slash <em>shortcuts.</em>
      </>
    ),
    body: '/review-pr, /triage, /changelog. Commands get pinned to your workspace the moment you install — no config file surgery.',
    tags: ['/slash', 'one-key', 'hotkeys'],
  },
  {
    idx: '04 / MCP Servers',
    title: (
      <>
        Real <em>tools,</em> real APIs.
      </>
    ),
    body: 'MCP servers bring the outside world in: Linear, Postgres, internal dashboards, your Figma library. Bundled, auth-handled, ready.',
    tags: ['MCP', 'OAuth', 'sandboxed'],
  },
  {
    idx: '05 / The Facet',
    title: (
      <>
        All four, <em>packed</em> into one.
      </>
    ),
    body: (
      <>
        A facet is the bundle. Publish one, <code>facet add viper-plans</code>, and every primitive lands at once — no
        glue, no drift.
      </>
    ),
    tags: ['one install', 'semver', 'reproducible'],
  },
]

export const PRIMITIVE_CARDS: readonly PrimitiveCardCopy[] = [
  {
    num: '01',
    slug: 'skills',
    badge: 'skills/',
    title: (
      <>
        Procedural <em>know-how.</em>
      </>
    ),
    body: 'Structured recipes your agent can follow — from "write a PR description" to "run a TPM standup."',
    tags: ['markdown', 'deterministic', 'composable'],
  },
  {
    num: '02',
    slug: 'agents',
    badge: 'agents/',
    title: (
      <>
        Specialists on <em>call.</em>
      </>
    ),
    body: 'Sub-agents with their own prompts, tools, and personalities. Spawn for a second opinion, a reviewer, a planner.',
    tags: ['sub-agent', 'scoped tools', 'memory'],
  },
  {
    num: '03',
    slug: 'cmds',
    badge: 'commands/',
    title: (
      <>
        Slash <em>shortcuts.</em>
      </>
    ),
    body: '/review-pr, /triage, /changelog. Pinned to your workspace the moment you install. No config surgery.',
    tags: ['/slash', 'one-key', 'hotkeys'],
  },
  {
    num: '04',
    slug: 'mcp',
    badge: 'mcp/',
    title: (
      <>
        Real <em>tools,</em> real APIs.
      </>
    ),
    body: 'MCP servers bring the outside world in: Linear, Postgres, internal dashboards, Figma — bundled, auth-handled.',
    tags: ['MCP', 'OAuth', 'sandboxed'],
  },
]

export const PACKED_COPY = {
  label: 'The Facet',
  title: (
    <>
      All four, <em>packed</em> into one.
    </>
  ),
  body: 'Publish once. Install once. Every primitive lands together — no glue, no drift.',
  code: 'facet add viper-plans',
} as const
