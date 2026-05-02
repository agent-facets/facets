import { useEffect, useState } from 'react'

/**
 * Cycle through `items` once on a fixed cadence, then stop on the
 * last item. Returns the current item and its index.
 *
 * Reduced-motion users see the first item only — no cycling at all.
 *
 * One-shot semantics are deliberate: the landing-page rotors all
 * settle on a final "thesis" word ("Manage", "capabilities") that
 * the page is supposed to leave the visitor with. A rotor that
 * loops forever is almost certainly a bug. If you ever need looping
 * back, add it as an opt-in `{ loop: true }` option — don't change
 * the default.
 *
 * @example
 *   const [verb] = useRotation(['Find', 'Install', 'Manage'], 3500)
 *   //=> 'Find' → (3.5s) → 'Install' → (3.5s) → 'Manage' (held forever)
 */
export function useRotation<T>(items: readonly T[], intervalMs: number): readonly [T, number] {
  const [i, setI] = useState(0)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) return
    }
    // Already on the last item — nothing more to advance to. Skip
    // the interval entirely so we don't waste a timer firing every
    // intervalMs just to no-op.
    if (i >= items.length - 1) return
    const id = window.setTimeout(() => setI((n) => n + 1), intervalMs)
    return () => window.clearTimeout(id)
  }, [i, items, intervalMs])

  return [items[i] as T, i] as const
}
