import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

/**
 * Internal mode state. `'system'` means we're tracking the OS preference
 * reactively; `'dark'` / `'light'` means the user has made an explicit
 * choice that overrides the OS.
 *
 * The hook's public API still returns just `Theme` (the resolved value)
 * — `'system'` never escapes the hook.
 */
type Mode = 'system' | Theme

const STORAGE_KEY = 'agentfacets.theme'
const DEFAULT_THEME = 'light' satisfies Theme

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readInitialMode(): Mode {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
    return 'system'
  } catch {
    return 'system'
  }
}

function resolveTheme(mode: Mode): Theme {
  return mode === 'system' ? getSystemTheme() : mode
}

/**
 * Read + toggle the landing page's theme. Three internal modes:
 *
 *   - `'system'`  — track OS preference reactively (default on first visit)
 *   - `'light'`   — explicit user choice, persisted to localStorage
 *   - `'dark'`    — explicit user choice, persisted to localStorage
 *
 * Behavior:
 *   - First visit (no localStorage entry): mode is `'system'`. Displayed
 *     theme follows OS preference, including live OS-level changes.
 *   - User clicks the toggle: mode flips between explicit `'light'` and
 *     `'dark'`, persisted so refreshes are sticky.
 *   - User has explicit choice AND OS preference changes mid-session:
 *     we wipe the localStorage entry and snap back to `'system'`, on
 *     the assumption that the OS change is a stronger signal than the
 *     stale explicit choice.
 *
 * The hook returns the resolved `Theme` (never `'system'`) plus a toggle.
 */
export function useTheme(): readonly [Theme, () => void] {
  const [mode, setMode] = useState<Mode>(readInitialMode)
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readInitialMode()))

  // Mirror the resolved theme onto the DOM whenever it changes.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Subscribe to OS-level theme changes. In `'system'` mode we just
  // update the resolved theme; in explicit mode we treat the OS change
  // as a signal to abandon the explicit choice (snap back to system).
  useEffect(() => {
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handlePrefChange = (e: MediaQueryListEvent) => {
      const next: Theme = e.matches ? 'dark' : 'light'
      if (mode === 'system') {
        setTheme(next)
        return
      }
      // Explicit mode + OS changed: snap back to system.
      try {
        window.localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Storage may be unavailable (private mode, etc.) — non-fatal.
      }
      setMode('system')
      setTheme(next)
    }
    darkQuery.addEventListener('change', handlePrefChange)
    return () => darkQuery.removeEventListener('change', handlePrefChange)
  }, [mode])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      setMode(next)
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Storage may be unavailable (private mode, etc.) — non-fatal.
      }
      return next
    })
  }, [])

  return [theme, toggle] as const
}
