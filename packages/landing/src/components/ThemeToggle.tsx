import { useTheme } from '../hooks/useTheme'
import styles from './ThemeToggle.module.css'

/**
 * Theme toggle pill. The label + glyph describe the target theme the
 * click will switch TO, matching the convention agreed in the design chat.
 */
export function ThemeToggle() {
  const [theme, toggle] = useTheme()
  const target = theme === 'dark' ? 'Light' : 'Dark'
  const glyph = theme === 'dark' ? '☀' : '☾'
  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggle}
      aria-label={`Switch to ${target.toLowerCase()} theme`}
    >
      <span aria-hidden="true">{glyph}</span>
      <span>{target}</span>
    </button>
  )
}
