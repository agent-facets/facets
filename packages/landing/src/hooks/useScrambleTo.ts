import { useEffect, useRef, useState } from 'react'

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&/<>{}+=*'

/**
 * Animate `target` text in by scrambling random glyphs and progressively
 * revealing the real characters left-to-right over `ms`. Spaces are
 * preserved so multi-word strings ("mcp servers") don't shift width.
 *
 * Honors `prefers-reduced-motion` — reduces to a static pass-through.
 *
 * @example
 *   const out = useScrambleTo(noun, 700)  //=> 'a%X#3' → 'agents'
 */
export function useScrambleTo(target: string, ms = 700): string {
  const [out, setOut] = useState(target)
  const startedFor = useRef(target)

  useEffect(() => {
    startedFor.current = target

    if (typeof window !== 'undefined') {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        setOut(target)
        return
      }
    }

    const start = performance.now()
    let raf = 0

    const tick = (now: number) => {
      // Bail if a newer target has superseded this animation.
      if (startedFor.current !== target) return
      const t = Math.min(1, (now - start) / ms)
      const reveal = Math.floor(t * target.length)
      let s = ''
      for (let i = 0; i < target.length; i++) {
        if (i < reveal || target[i] === ' ') s += target[i]
        else s += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
      }
      setOut(s)
      if (t < 1) raf = requestAnimationFrame(tick)
      else setOut(target)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])

  return out
}
