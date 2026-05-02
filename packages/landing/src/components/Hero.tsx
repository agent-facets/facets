import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useRotation } from '../hooks/useRotation'
import { useScrambleTo } from '../hooks/useScrambleTo'
import { useTypeRotation } from '../hooks/useTypeRotation'
import { copyToClipboard } from '../lib/copy'
import { AgentPromptButton } from './AgentPromptButton'
import { Eyebrow } from './Eyebrow'
import styles from './Hero.module.css'
import { InstallBlock } from './InstallBlock'
import { OrbitFloaters } from './OrbitFloaters'
import { RegistryCta } from './RegistryCta'

/* All three rotors land on their LAST entry, so the page settles on
   the thesis "manage capabilities for any tool". Earlier entries open
   with familiar concepts and widen toward the abstraction. */

const VERBS = ['manage', 'find', 'install', 'share', 'manage'] as const
const NOUNS = ['capabilities', 'agents', 'skills', 'mcp servers', 'commands', 'capabilities'] as const
const TOOLS = ['any AI agent', 'Claude Code', 'Codex', 'Cursor', 'OpenCode', 'OpenClaw', 'any AI agent'] as const

/* All three rotors START their final transition at TARGET_RUNTIME_MS.
   They each then settle on their own natural animation duration (verb
   instantly, noun after SCRAMBLE_MS, tool after L_final × typeMs) —
   a ~700ms arrival cascade. Tune TARGET_RUNTIME_MS alone to dilate or
   compress the whole hero landing; the per-rotor cadences below
   re-derive automatically when content or feel knobs change.

   Solving each rotor so its (N-1)th transition fires at TARGET:
     verb interval = TARGET / (N-1)
     noun interval = TARGET / (N-1)        (scramble happens after start)
     tool hold     = (TARGET - typing_nonfinal - deleting_nonfinal) / (N-1)
   where typing_nonfinal / deleting_nonfinal sum over items 0..N-2
   (the final item's typing/hold happen after the start moment). */

const TARGET_RUNTIME_MS = 20_000
const TOOL_TYPE_MS = 70
const TOOL_DELETE_MS = 35
const SCRAMBLE_MS = 700

const VERB_INTERVAL_MS = TARGET_RUNTIME_MS / Math.max(1, VERBS.length - 1)
const NOUN_INTERVAL_MS = TARGET_RUNTIME_MS / Math.max(1, NOUNS.length - 1)

const TOOL_NON_FINAL = TOOLS.slice(0, -1)
const TOOL_TYPING_BUDGET_MS = TOOL_NON_FINAL.reduce((sum, w) => sum + w.length * TOOL_TYPE_MS, 0)
const TOOL_DELETING_BUDGET_MS = TOOL_NON_FINAL.reduce((sum, w) => sum + w.length * TOOL_DELETE_MS, 0)
const TOOL_HOLD_MS = Math.max(
  0,
  (TARGET_RUNTIME_MS - TOOL_TYPING_BUDGET_MS - TOOL_DELETING_BUDGET_MS) / Math.max(1, TOOLS.length - 1),
)

/**
 * sr-only recipe — visible to assistive tech, invisible to sighted users.
 * Inline because this is the only consumer in the package; if a second
 * component needs it, lift to a shared utility.
 *
 * Used to give the rotating headline + sub a single stable accessible
 * reading. The animated DOM is `aria-hidden`, so screen readers only see
 * these static spans. The values mirror VERBS[0] / NOUNS[0] / TOOLS[0],
 * which (by design) also equal the settled last entries — so AT users
 * get the same content as `prefers-reduced-motion` users.
 */
const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  borderWidth: 0,
}

export function Hero() {
  const [verb] = useRotation(VERBS, VERB_INTERVAL_MS)
  const [noun] = useRotation(NOUNS, NOUN_INTERVAL_MS)
  const nounOut = useScrambleTo(noun, SCRAMBLE_MS)
  const { shown: tool, done: toolDone } = useTypeRotation(TOOLS, {
    typeMs: TOOL_TYPE_MS,
    holdMs: TOOL_HOLD_MS,
    deleteMs: TOOL_DELETE_MS,
  })

  return (
    <section className={styles.hero}>
      <div className={styles.heroBg} />
      <div className={styles.heroGrid} />

      <OrbitFloaters />

      <div className={styles.eyebrowRow}>
        <Eyebrow href="https://docs.agentfacets.io/roadmap/alpha">v{__APP_VERSION__} · pre-release alpha</Eyebrow>
      </div>

      <h1 className={styles.title}>
        {/*
         * Single stable sentence for assistive tech. The animated DOM
         * below is aria-hidden so screen readers don't hear the rotors
         * cycle (which previously read scrambled glyphs and partial
         * words at every interval).
         */}
        <span style={VISUALLY_HIDDEN_STYLE}>
          The simple and safe way to {VERBS[0]} {NOUNS[0]}
        </span>
        <span className={styles.preamble} aria-hidden="true">
          The simple and safe way to
        </span>
        <span className={styles.verbSlot} aria-hidden="true">
          <span key={verb} className={styles.verbWord}>
            {verb}
          </span>
        </span>
        <span className={styles.scrambleSlot} aria-hidden="true">
          <span className={`${styles.accent} ${styles.scrambleNoun}`}>{nounOut}</span>
        </span>
      </h1>

      <p className={styles.sub}>
        <span style={VISUALLY_HIDDEN_STYLE}>for {TOOLS[0]}.</span>
        <span className={`${styles.preamble} ${styles.subPrefix}`} aria-hidden="true">
          for
        </span>
        <span className={styles.toolSlot} aria-hidden="true">
          <span className={styles.toolWord}>{tool}</span>
          <span className={`${styles.caret}${toolDone ? ` ${styles.caretHidden}` : ''}`} aria-hidden="true" />
        </span>
      </p>

      <div className={styles.ctaRegion}>
        <div className={styles.installPillWrap}>
          <InstallBlock />
        </div>

        <div className={styles.installNote}>
          one-liner · macOS · Linux · works with Claude, Cursor, Codex &amp; more
        </div>
        <AgentPromptButton />
      </div>

      <RegistryCta className={styles.mobileCta} />
      <div className={styles.installNoteMobile}>Search 200+ facets · install from your desktop with one line</div>

      <div className={styles.ctaRow}>
        <a href="#demo">
          See it in action <span className={styles.arrow}>→</span>
        </a>
        <span className={styles.sep}>·</span>
        <a href="https://facet.cafe/" target="_blank" rel="noreferrer noopener">
          Browse the registry <span className={styles.arrow}>↗</span>
        </a>
        <span className={styles.sep}>·</span>
        <a href="https://docs.agentfacets.io">
          Learn more about facets <span className={styles.arrow}>↗</span>
        </a>
      </div>
    </section>
  )
}
