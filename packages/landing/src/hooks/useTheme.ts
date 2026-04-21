import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'agentfacets.theme'
const DEFAULT_THEME = 'light' satisfies Theme

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)

    if (stored === 'dark' || stored === 'light') return stored

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return DEFAULT_THEME
  }
}

/**
 * Read + toggle the landing page's theme. Persists to `localStorage` and
 * mirrors the value onto `document.documentElement.dataset.theme` so CSS
 * custom properties swap between the dark and light variable sets.
 */
export function useTheme(): readonly [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage may be unavailable (private mode, etc.) — non-fatal.
    }

    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handlePrefChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')

    darkQuery.addEventListener('change', handlePrefChange)
    return () => darkQuery.removeEventListener('change', handlePrefChange)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return [theme, toggle] as const
}
