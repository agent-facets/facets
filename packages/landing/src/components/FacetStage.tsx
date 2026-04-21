import { type ReactNode, useRef } from 'react'
import { useScrollProgress } from '../hooks/useScrollProgress'
import styles from './FacetStage.module.css'

type BoxDef = {
  className: string
  icon: string
  title: string
  sub: string
}

const BOXES: readonly BoxDef[] = [
  { className: styles.fbSkills, icon: 'S', title: 'skills/', sub: 'procedural know-how' },
  { className: styles.fbAgents, icon: 'A', title: 'agents/', sub: 'specialist personas' },
  { className: styles.fbCmds, icon: '/', title: 'commands/', sub: 'slash triggers' },
  { className: styles.fbMcp, icon: 'M', title: 'mcp/', sub: 'tool servers' },
]

/**
 * LAYOUTS.stack — 5 steps × 4 box transform strings. Lifted verbatim from
 * the mockup so the visual choreography matches pixel-for-pixel.
 *
 *   Step 0: skills featured (top), others stacked below
 *   Step 1: agents featured
 *   Step 2: commands featured
 *   Step 3: mcp featured (bottom-most rises to top)
 *   Step 4: packed into facet — all four collapse to center, diamond appears
 */
const STACK_LAYOUTS: readonly (readonly string[])[] = [
  [
    'translate(-50%,-50%) translateY(0) rotateX(0) scale(1.08)',
    'translate(-50%,-50%) translateY(120px) rotateX(25deg) scale(0.85)',
    'translate(-50%,-50%) translateY(200px) rotateX(35deg) scale(0.7)',
    'translate(-50%,-50%) translateY(280px) rotateX(45deg) scale(0.55)',
  ],
  [
    'translate(-50%,-50%) translateY(-120px) rotateX(-25deg) scale(0.85)',
    'translate(-50%,-50%) translateY(0) rotateX(0) scale(1.08)',
    'translate(-50%,-50%) translateY(120px) rotateX(25deg) scale(0.85)',
    'translate(-50%,-50%) translateY(200px) rotateX(35deg) scale(0.7)',
  ],
  [
    'translate(-50%,-50%) translateY(-200px) rotateX(-35deg) scale(0.7)',
    'translate(-50%,-50%) translateY(-120px) rotateX(-25deg) scale(0.85)',
    'translate(-50%,-50%) translateY(0) rotateX(0) scale(1.08)',
    'translate(-50%,-50%) translateY(120px) rotateX(25deg) scale(0.85)',
  ],
  [
    'translate(-50%,-50%) translateY(-240px) rotateX(-40deg) scale(0.65)',
    'translate(-50%,-50%) translateY(-160px) rotateX(-28deg) scale(0.8)',
    'translate(-50%,-50%) translateY(-80px) rotateX(-15deg) scale(0.92)',
    'translate(-50%,-50%) translateY(0) rotateX(0) scale(1.08)',
  ],
  [
    'translate(-50%,-50%) translateY(-36px) scale(0.6) rotateX(0)',
    'translate(-50%,-50%) translateY(-12px) scale(0.6) rotateX(0)',
    'translate(-50%,-50%) translateY(12px) scale(0.6) rotateX(0)',
    'translate(-50%,-50%) translateY(36px) scale(0.6) rotateX(0)',
  ],
]

type StepCopy = {
  idx: string
  title: ReactNode
  body: ReactNode
  tags: readonly string[]
}

const STEPS: readonly StepCopy[] = [
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

/**
 * Scroll-linked stage: as the user scrolls through the 400vh container,
 * the 4 facet boxes animate through 5 choreographed positions and the
 * diamond wrapper fades in on the last step.
 */
export function FacetStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const progress = useScrollProgress(stageRef)
  const step = Math.min(4, Math.floor(progress * 5))
  const layout = STACK_LAYOUTS[step] ?? STACK_LAYOUTS[0]

  return (
    <div ref={stageRef} className={styles.stage}>
      <div className={styles.sticky}>
        <div className={styles.canvas}>
          <div className={styles.scene}>
            <div className={`${styles.diamond}${step === 4 ? ` ${styles.active}` : ''}`} aria-hidden="true" />
            {BOXES.map((box, i) => {
              const transform = layout?.[i]
              const opacity = step < 4 ? (i === step ? 1 : 0.38) : 1
              return (
                <div key={box.title} className={`${styles.box} ${box.className}`} style={{ transform, opacity }}>
                  <div className={styles.boxIcon}>{box.icon}</div>
                  <div className={styles.boxMeta}>
                    <div className={styles.boxTitle}>{box.title}</div>
                    <div className={styles.boxSub}>{box.sub}</div>
                  </div>
                </div>
              )
            })}
            <div className={`${styles.sceneLabel}${step === 4 ? ` ${styles.active}` : ''}`} aria-hidden="true">
              facet · &nbsp;one
              <br />
              primitives · four
              <br />
              setup · zero
            </div>
          </div>
        </div>

        <div className={styles.copy}>
          {STEPS.map((s, i) => (
            <div key={s.idx} className={`${styles.step}${i === step ? ` ${styles.active}` : ''}`}>
              <div className={styles.stepIdx}>{s.idx}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <div className={styles.tagRow}>
                {s.tags.map((t) => (
                  <span key={t} className={styles.chip}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
