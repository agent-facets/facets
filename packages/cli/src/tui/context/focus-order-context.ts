import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react'

/**
 * Focus ids whose field consumes plain Tab for its own action instead of
 * advancing focus. `useNavigationKeys` checks this set so it does not also
 * move focus forward when one of these fields handles Tab itself. The privacy
 * toggle (`field-private`) uses Tab to flip Public/Private; ↓ still advances,
 * and Shift+Tab still moves backward.
 */
export const TAB_TOGGLE_FOCUS_IDS: ReadonlySet<string> = new Set(['field-private'])

interface FocusOrderState {
  focusedId: string | null
  focusIds: string[]
  setFocusIds: (ids: string[]) => void
  setFocusedId: Dispatch<SetStateAction<string | null>>
  focusNext: () => void
  focusPrevious: () => void
  focus: (id: string) => void
}

const FocusOrderContext = createContext<FocusOrderState>({
  focusedId: null,
  focusIds: [],
  setFocusIds: () => {},
  setFocusedId: () => {},
  focusNext: () => {},
  focusPrevious: () => {},
  focus: () => {},
})

export function FocusOrderProvider({
  children,
  initialFocusId,
}: {
  children: ReactNode
  initialFocusId?: string | null
}) {
  const [focusIds, setFocusIds] = useState<string[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(initialFocusId ?? null)

  const focusNext = useCallback(() => {
    setFocusedId((current) => {
      if (!current || focusIds.length === 0) return focusIds[0] ?? null
      const idx = focusIds.indexOf(current)
      if (idx === -1) return focusIds[0] ?? null
      if (idx === focusIds.length - 1) return current
      return focusIds[idx + 1] ?? null
    })
  }, [focusIds])

  const focusPrevious = useCallback(() => {
    setFocusedId((current) => {
      if (!current || focusIds.length === 0) return focusIds[0] ?? null
      const idx = focusIds.indexOf(current)
      if (idx === -1) return focusIds[0] ?? null
      if (idx === 0) return current
      return focusIds[idx - 1] ?? null
    })
  }, [focusIds])

  const focus = useCallback((id: string) => {
    setFocusedId(id)
  }, [])

  const value = useMemo(
    () => ({ focusedId, focusIds, setFocusIds, setFocusedId, focusNext, focusPrevious, focus }),
    [focusedId, focusIds, focusNext, focusPrevious, focus],
  )

  return createElement(FocusOrderContext.Provider, { value }, children)
}

export function useFocusOrder() {
  return useContext(FocusOrderContext)
}
