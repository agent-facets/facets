import { useCallback, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import { useTheme } from '../hooks/useTheme.ts'
import { BrandMark } from './BrandMark'
import { MobileMenu } from './MobileMenu'
import styles from './Nav.module.css'
import { ThemeToggle } from './ThemeToggle'

/**
 * Top nav bar. On desktop the brand mark links back to top (href="#top"),
 * matching the existing behavior. On mobile the brand mark becomes a
 * hamburger trigger — tapping it opens the `MobileMenu` slide-down sheet.
 * The dual role is rendered conditionally via `useIsMobile()` so there's
 * only ever one landmark in the DOM at a time.
 */
export function Nav() {
  const isMobile = useIsMobile()
  const [theme] = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    // Return focus to the brand-mark trigger on close.
    triggerRef.current?.focus()
  }, [])

  const toggleMenu = useCallback(() => {
    setMenuOpen((v) => !v)
  }, [])

  const designLink = useMemo(() => `/design-${theme}`, [theme])

  return (
    <>
      <div id="top" />
      <nav className={styles.nav}>
        {isMobile ? (
          <button
            ref={triggerRef}
            type="button"
            className={styles.brand}
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <BrandMark />
            Agent Facets
          </button>
        ) : (
          <a className={styles.brand} href={designLink} aria-label="Agent Facets — back to top">
            <BrandMark />
            Agent Facets
          </a>
        )}

        <div className={styles.links}>
          <a href="#top">Home</a>
          <a href="#what">Learn</a>
          <a href="#demo">Demo</a>
          <a href="https://docs.agentfacets.io" target="_self">
            Docs
          </a>
          <a href="https://docs.agentfacets.io/cli" target="_self">
            Reference
          </a>
          <a href="https://facet.cafe/" target="_blank" rel="noreferrer noopener">
            Registry <span className={styles.extArrow}>↗</span>
          </a>
        </div>

        <div className={styles.right}>
          <ThemeToggle />
          <a
            className={styles.ghbtn}
            href="https://github.com/agent-facets/facets"
            target="_blank"
            rel="noreferrer noopener"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
        </div>
      </nav>
      {isMobile ? <MobileMenu open={menuOpen} onClose={closeMenu} /> : null}
    </>
  )
}
