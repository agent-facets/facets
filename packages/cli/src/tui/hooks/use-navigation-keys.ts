import { useInput } from 'ink'
import { useFocusMode } from '../context/focus-mode-context.ts'
import { TAB_TOGGLE_FOCUS_IDS, useFocusOrder } from '../context/focus-order-context.ts'

export function useNavigationKeys() {
  const { mode } = useFocusMode()
  const { focusNext, focusPrevious, focusedId } = useFocusOrder()

  const isActive = mode === 'form-navigation' || mode === 'form-confirmation'

  useInput(
    (_input, key) => {
      // Shift+Tab must be checked before plain Tab: terminals send Shift+Tab
      // with both `key.tab` and `key.shift` set, so a leading `key.tab` branch
      // would swallow it and move focus forward instead of backward.
      if (key.upArrow || (key.shift && key.tab)) {
        focusPrevious()
        return
      }
      // A few fields claim plain Tab for their own action (e.g. the privacy
      // toggle uses Tab to flip Public/Private). For those, Tab must NOT also
      // advance focus — only ↓ moves forward. Shift+Tab still moves backward.
      if (key.tab && focusedId !== null && TAB_TOGGLE_FOCUS_IDS.has(focusedId)) {
        return
      }
      if (key.downArrow || key.tab) {
        focusNext()
        return
      }
      if (mode === 'form-confirmation') {
        if (key.rightArrow) {
          focusNext()
          return
        }
        if (key.leftArrow) {
          focusPrevious()
          return
        }
      }
    },
    { isActive },
  )
}
