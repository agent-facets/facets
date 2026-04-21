import { useEffect } from 'react'

/** Mirrors `scroll-margin-top` in global.css so anchors clear the nav. */
const NAV_OFFSET_PX = 88

/**
 * Intercepts same-page `<a href="#id">` clicks and scrolls to the target
 * without updating the URL hash. Relies on the browser's native
 * `scroll-behavior: smooth` (set on <html>) to animate the scroll — we
 * just preventDefault on the click and call `window.scrollTo` with the
 * target's position, skipping the history push.
 *
 * `#top` is treated as "scroll to page top" (browser built-in semantic).
 */
export function useSilentAnchorScroll() {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (event.button !== 0) return

      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href?.startsWith('#') || href.length < 2) return
      if (anchor.target && anchor.target !== '_self') return

      const id = href.slice(1)
      let top: number
      if (id === 'top') {
        top = 0
      } else {
        const target = document.getElementById(id)
        if (!target) return
        top = target.getBoundingClientRect().top + window.scrollY - NAV_OFFSET_PX
      }

      event.preventDefault()
      window.scrollTo({ top, left: 0 })
    }

    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])
}
