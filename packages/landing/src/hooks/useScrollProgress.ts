import { type RefObject, useEffect, useState } from 'react'

/**
 * Returns the current scroll progress (0..1) through a tall element,
 * computed relative to the viewport:
 *
 *   progress = clamp(-rect.top / (offsetHeight - window.innerHeight))
 *
 * This matches the pattern used for position:sticky scroll-linked scenes:
 * 0 while the element is fully below the viewport, 1 when fully scrolled past.
 *
 * RAF-coalesced and passive. If the user prefers reduced motion, returns
 * `1` immediately so consumers jump to the final state without animation.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setProgress(1)
      return
    }

    let frame = 0
    let queued = false

    const compute = () => {
      queued = false
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const total = el.offsetHeight - window.innerHeight
      if (total <= 0) {
        setProgress(0)
        return
      }
      const scrolled = Math.max(0, Math.min(total, -rect.top))
      setProgress(scrolled / total)
    }

    const handle = () => {
      if (queued) return
      queued = true
      frame = window.requestAnimationFrame(compute)
    }

    compute()
    window.addEventListener('scroll', handle, { passive: true })
    window.addEventListener('resize', handle)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', handle)
      window.removeEventListener('resize', handle)
    }
  }, [ref])

  return progress
}
