import { useEffect, useRef } from 'react'
import styles from './MobileMenu.module.css'

type MenuLink = {
  label: string
  href: string
  external?: boolean
}

/**
 * Mobile menu entries in display order. In-page anchors first (Home,
 * Facets, CLI), then external destinations (Docs, Registry, GitHub).
 * Theme toggle is deliberately kept in the nav bar itself so users
 * don't have to open the menu to change themes.
 */
const LINKS: readonly MenuLink[] = [
  { label: 'Home', href: '#top' },
  { label: 'Learn', href: '#what' },
  { label: 'CLI', href: '#demo' },
  { label: 'Docs', href: 'https://docs.agentfacets.io' },
  { label: 'Reference', href: 'https://docs.agentfacets.io/cli' },
  { label: 'Registry', href: 'https://facet.cafe/', external: true },
  { label: 'GitHub', href: 'https://github.com/agent-facets/facets', external: true },
]

type MobileMenuProps = {
  open: boolean
  onClose: () => void
}

/**
 * Full-width slide-down menu for mobile viewports. Triggered by the
 * brand mark in the nav bar. Closes on link tap, backdrop tap, or
 * Escape key. Body scroll is locked while open. Focus moves to the
 * first link on open; the parent component is responsible for
 * returning focus to the trigger on close.
 *
 * The panel is always mounted (not conditionally rendered) so its
 * slide-in transition has something to animate; the `open` prop
 * toggles a class that drives the transform/opacity.
 */
export function MobileMenu({ open, onClose }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const firstLinkRef = useRef<HTMLAnchorElement>(null)

  // Lock body scroll while the menu is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
    }
  }, [open, onClose])

  // Move focus to the first link on open.
  useEffect(() => {
    if (!open) return
    // Defer a tick so the browser has flipped the `aria-hidden` state.
    const id = window.requestAnimationFrame(() => {
      firstLinkRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(id)
    }
  }, [open])

  return (
    <div
      className={`${styles.root}${open ? ` ${styles.open}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Main menu"
      aria-hidden={!open}
    >
      {/* Backdrop: sits behind the panel so tapping outside closes. */}
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close menu"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <div ref={panelRef} className={styles.panel} id="mobile-menu">
        <nav className={styles.links} aria-label="Mobile navigation">
          {LINKS.map((link, i) => {
            const externalProps = link.external ? { target: '_blank', rel: 'noreferrer noopener' } : {}
            return (
              <a
                key={link.label}
                ref={i === 0 ? firstLinkRef : undefined}
                href={link.href}
                onClick={onClose}
                tabIndex={open ? 0 : -1}
                className={styles.link}
                {...externalProps}
              >
                <span>{link.label}</span>
                {link.external ? (
                  <span className={styles.extArrow} aria-hidden="true">
                    ↗
                  </span>
                ) : null}
              </a>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
