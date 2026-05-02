/**
 * Single source of truth for clipboard copying in the landing package.
 *
 * Consumers should NOT roll their own clipboard logic. Use
 * `copyToClipboard` for the happy path; it handles the
 * `navigator.clipboard` API when available and falls back to the
 * legacy `document.execCommand('copy')` path for browsers without
 * Clipboard API support or in non-secure contexts (e.g., http:// or
 * file:// where the modern API is gated off).
 */

/**
 * Legacy fallback that creates an off-screen `<textarea>`, selects its
 * contents, and triggers `document.execCommand('copy')`. Returns
 * `true` on success, `false` on any failure. Used when the modern
 * Clipboard API isn't available.
 */
export function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * Copy `text` to the clipboard. Tries `navigator.clipboard.writeText`
 * first (only when `isSecureContext !== false`); falls back to
 * `fallbackCopy` if the modern API is missing, blocked, or rejects.
 *
 * Always resolves — never throws. Returns `true` if the write
 * succeeded by either mechanism, `false` if both failed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext !== false) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return fallbackCopy(text)
    }
  }
  return fallbackCopy(text)
}
