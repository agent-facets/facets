import { useEffect, useState } from 'react'

/**
 * Type-in / hold / type-out rotor. Cycles through `items` once by
 * typing each one character at a time, holding briefly, deleting
 * backward, and advancing. The final item types in, holds, and then
 * stays visible forever — there's no perpetual loop. The current
 * partial string is exposed as `shown`.
 *
 * Reduced-motion users see the first item, fully typed, with no
 * cycling.
 *
 * Cadences (in ms) are tuned to feel like a confident terminal-style
 * prompt — not too fast, not too slow:
 *   - typeMs: time per character while typing in
 *   - holdMs: pause once fully typed
 *   - deleteMs: time per character while typing out (faster than typing in)
 *
 * One-shot semantics are deliberate. A rotor that loops forever is
 * almost certainly a bug — the landing-page sub line is supposed to
 * settle on a final "thesis" word ("any tool"). If you ever need
 * looping back, add it as an opt-in `{ loop: true }` option —
 * don't change the default.
 *
 * Caller is responsible for passing a stable `items` reference. If
 * `items` is recreated on every render (e.g., as an inline literal),
 * the effect will re-fire on every render and the typing will reset.
 * The standard React contract: memoize at the call site.
 *
 * @example
 *   const { shown } = useTypeRotation(['Claude', 'Codex', 'any tool'])
 *   //=> cycles Claude → Codex → any tool, then holds "any tool" forever
 */
export function useTypeRotation(
  items: readonly string[],
  opts: { typeMs?: number; holdMs?: number; deleteMs?: number } = {},
): { shown: string; index: number; done: boolean } {
  const { typeMs = 70, holdMs = 1400, deleteMs = 35 } = opts
  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState('')
  const [phase, setPhase] = useState<'typing' | 'hold' | 'deleting' | 'done'>('typing')

  useEffect(() => {
    // Honor reduced motion: show the first item, fully typed, no cycle.
    if (typeof window !== 'undefined') {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        setShown(items[0] ?? '')
        return
      }
    }

    // Terminal state: the last item is fully typed and we've held.
    // No timers, no further state transitions — the final word just
    // stays on screen.
    if (phase === 'done') return

    const target = items[index] ?? ''
    let timeoutId: number | undefined

    if (phase === 'typing') {
      if (shown.length < target.length) {
        timeoutId = window.setTimeout(() => setShown(target.slice(0, shown.length + 1)), typeMs)
      } else {
        timeoutId = window.setTimeout(() => setPhase('hold'), 0)
      }
    } else if (phase === 'hold') {
      // If we're on the final item, freeze here forever. Otherwise
      // proceed to delete and advance.
      const isLast = index === items.length - 1
      if (isLast) {
        timeoutId = window.setTimeout(() => setPhase('done'), holdMs)
      } else {
        timeoutId = window.setTimeout(() => setPhase('deleting'), holdMs)
      }
    } else {
      // deleting
      if (shown.length > 0) {
        timeoutId = window.setTimeout(() => setShown(target.slice(0, shown.length - 1)), deleteMs)
      } else {
        // Advance to the next item and start typing it. We can't
        // reach this branch on the last item — the hold branch
        // above transitions straight to 'done' instead.
        setIndex((i) => i + 1)
        setPhase('typing')
      }
    }

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [shown, phase, index, items, typeMs, holdMs, deleteMs])

  return { shown, index, done: phase === 'done' }
}
