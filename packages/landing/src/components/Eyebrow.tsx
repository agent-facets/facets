import type { ReactNode } from 'react'
import styles from './Eyebrow.module.css'

type EyebrowProps = {
  children: ReactNode
  /**
   * Optional href. When set, the eyebrow renders as an `<a>` and picks up
   * the `.eyebrowLink` hover affordance. When omitted, it renders as a
   * non-interactive `<div>` (preserves the original behavior).
   */
  href?: string
}

/**
 * Small status pill with a pulsing dot — used above the hero headline.
 * Optionally a link when `href` is provided.
 */
export function Eyebrow({ children, href }: EyebrowProps) {
  if (href !== undefined) {
    return (
      <a className={`${styles.eyebrow} ${styles.eyebrowLink}`} href={href}>
        <span className={styles.dot} aria-hidden="true" />
        {children}
      </a>
    )
  }

  return (
    <div className={styles.eyebrow}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </div>
  )
}
