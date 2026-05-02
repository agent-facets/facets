import { useCallback, useEffect, useRef, useState } from 'react'
import { copyToClipboard } from '../lib/copy'
import styles from './InstallBlock.module.css'

/**
 * The canonical one-liner the button copies to the clipboard. Matches
 * `infra/site.ts` which serves `install.sh` at the apex `/install` path.
 */
export const INSTALL_CMD = 'curl -fsSL https://agentfacets.io/install | bash'

const COPIED_RESET_MS = 1800

/**
 * Full-width click-to-copy install command. The entire pill is one button —
 * clicking anywhere (prompt, text, or the gradient "Copy" cap) runs the
 * copy and swaps the cap label between "Copy" and "Copied" without layout
 * shift.
 */
export function InstallBlock() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const handleClick = useCallback(async () => {
    setCopied(await copyToClipboard(INSTALL_CMD))
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }, [])

  return (
    <button
      type="button"
      className={`${styles.install}${copied ? ` ${styles.copied}` : ''}`}
      onClick={handleClick}
      aria-label="Copy install command to clipboard"
    >
      <span className={styles.prompt}>$</span>
      <span className={styles.cmd}>
        curl&nbsp;<span className={styles.flag}>-fsSL</span>
        &nbsp;https://agentfacets.io/install&nbsp;<span className={styles.pipe}>|</span>&nbsp;bash
      </span>
      <span className={styles.copy} aria-hidden="true">
        <span className={styles.copyInner}>
          <span className={`${styles.copyState} ${styles.copyIdle}`}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="4" y="4" width="9" height="10" rx="1" />
              <path d="M3 11V3a1 1 0 011-1h8" />
            </svg>
            Copy
          </span>
          <span className={`${styles.copyState} ${styles.copyDone}`}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 8.5l3.2 3.2L13 5" />
            </svg>
            Copied
          </span>
        </span>
      </span>
    </button>
  )
}
