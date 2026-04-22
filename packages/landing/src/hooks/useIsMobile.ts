import { useEffect, useState } from 'react'

/**
 * The source of truth for the mobile breakpoint for TypeScript, in pixels.
 *
 * Keep this synced with the `--mobile-width` value in `global.css`.
 */
export const MOBILE_BREAKPOINT_PX = 1024

const MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`

/**
 * Returns `true` when the viewport is at or below the mobile breakpoint.
 *
 * SSR-safe: the initial render always returns `false` (desktop) to
 * avoid hydration mismatch. The real value is computed in `useEffect`
 * after mount. Consumers that render differently on mobile vs desktop
 * will briefly show the desktop variant, then swap on the next frame —
 * acceptable for this landing site, where the initial HTML is generic.
 *
 * Listens for viewport changes via `matchMedia.addEventListener` so
 * resizes across the breakpoint update the result live.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mq = window.matchMedia(MEDIA_QUERY)
    setIsMobile(mq.matches)

    const handler = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }

    mq.addEventListener('change', handler)
    return () => {
      mq.removeEventListener('change', handler)
    }
  }, [])

  return isMobile
}
