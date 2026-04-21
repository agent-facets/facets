import type { CSSProperties } from 'react'
import styles from './OrbitFloaters.module.css'

type Floater = {
  label: string
  accent: string
  style: CSSProperties
  delay: string
}

const FLOATERS: readonly Floater[] = [
  { label: 'skills/', accent: 'var(--accent-a)', style: { top: '22%', left: '10%' }, delay: '0s' },
  { label: 'agents/', accent: 'var(--accent-b)', style: { top: '35%', right: '12%' }, delay: '1.5s' },
  {
    label: 'commands/',
    accent: 'var(--accent-c)',
    style: { bottom: '30%', left: '19%' },
    delay: '3s',
  },
  { label: 'mcp/', accent: 'var(--accent-d)', style: { bottom: '38%', right: '20%' }, delay: '4.5s' },
]

/**
 * Four floating directory pills that drift around the hero, staggered to
 * suggest the four primitives orbiting the "facet".
 */
export function OrbitFloaters() {
  return (
    <div className={styles.orbits} aria-hidden="true">
      {FLOATERS.map((f) => (
        <div key={f.label} className={styles.box} style={{ ...f.style, animationDelay: f.delay }}>
          <span className={styles.swatch} style={{ background: f.accent }} />
          {f.label}
        </div>
      ))}
    </div>
  )
}
