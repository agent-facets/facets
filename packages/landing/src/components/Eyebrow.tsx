import type { ReactNode } from 'react'
import styles from './Eyebrow.module.css'

type EyebrowProps = {
  children: ReactNode
}

/**
 * Small status pill with a pulsing dot — used above the hero headline.
 */
export function Eyebrow({ children }: EyebrowProps) {
  return (
    <div className={styles.eyebrow}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </div>
  )
}
