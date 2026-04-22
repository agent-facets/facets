import type { ReactNode } from 'react'
import styles from './LinkCard.module.css'

type LinkCardProps = {
  href: string
  /**
   * Small uppercase eyebrow label above the value. E.g. "Browse the
   * registry", "Learn about facets".
   */
  label: string
  /**
   * The primary text of the card — usually the destination host or
   * page title. E.g. "facet.cafe", "docs.agentfacets.io".
   */
  value: string
  /**
   * Icon content for the left-hand square. Pass an inline SVG. The
   * icon inherits `currentColor` from the square's `color` prop; use
   * `iconColor` to set that per-card.
   */
  icon: ReactNode
  /**
   * CSS color applied to the icon square's `color` property so inline
   * SVGs using `currentColor` pick it up. Defaults to `var(--accent-b)`.
   */
  iconColor?: string
  /**
   * When true, opens in a new tab with rel="noreferrer noopener" and
   * shows the external-link arrow. Defaults to true since every use
   * of this card today points at an off-site destination; in-page
   * anchors should use the plainer Hero CTA pills.
   */
  external?: boolean
  className?: string
}

/**
 * Gradient-washed card with a square icon slot, a small label, a
 * primary value line, and an arrow. Used in Hero, Explainer, and
 * Closer for prominent off-site CTAs. Originally introduced as
 * `RegistryCta` for facet.cafe on mobile; generalized so the same
 * visual language can advertise any destination.
 */
export function LinkCard({ href, label, value, icon, iconColor, external = true, className }: LinkCardProps) {
  const externalProps = external ? { target: '_blank', rel: 'noreferrer noopener' as const } : {}
  return (
    <a className={`${styles.card}${className ? ` ${className}` : ''}`} href={href} {...externalProps}>
      <span className={styles.icon} style={iconColor ? { color: iconColor } : undefined} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
      </span>
      <svg
        className={styles.arrow}
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {external ? (
          <>
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </>
        ) : (
          <path d="M5 12h14M13 5l7 7-7 7" />
        )}
      </svg>
    </a>
  )
}
