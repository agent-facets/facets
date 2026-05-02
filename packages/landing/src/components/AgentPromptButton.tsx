import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_PROMPT_POINTER } from '../lib/agent-prompt'
import { copyToClipboard } from '../lib/copy'
import styles from './Hero.module.css'

const AGENT_COPIED_RESET_MS = 2200

export function AgentPromptButton() {
  const [agentCopied, setAgentCopied] = useState(false)

  const agentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (agentTimerRef.current) clearTimeout(agentTimerRef.current)
    },
    [],
  )

  const copyAgentPrompt = useCallback(async () => {
    setAgentCopied(await copyToClipboard(AGENT_PROMPT_POINTER))
    if (agentTimerRef.current) clearTimeout(agentTimerRef.current)
    agentTimerRef.current = setTimeout(() => setAgentCopied(false), AGENT_COPIED_RESET_MS)
  }, [])

  return (
    <button
      type="button"
      className={`${styles.agentBreakout}${agentCopied ? ` ${styles.copied}` : ''}`}
      onClick={copyAgentPrompt}
      aria-label="Copy agent prompt to clipboard"
    >
      <span className={styles.agentInner}>
        <span className={`${styles.agentState} ${styles.agentIdle}`}>
          <span className={styles.sparkle} aria-hidden="true" />
          <span>or just hand this prompt to your agent</span>
          <span className={styles.copyBadge}>Copy</span>
        </span>
        <span className={`${styles.agentState} ${styles.agentDone}`}>
          <span className={styles.checkmark} aria-hidden="true">
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
          </span>
          <span>Copied — paste into your agent</span>
          <span className={styles.copyBadge}>Copied</span>
        </span>
      </span>
    </button>
  )
}
