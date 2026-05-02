/**
 * Single source of truth for the agent prompt URL and the pointer text
 * the AgentPromptButton copies to the clipboard.
 *
 * The button does NOT copy the prompt body. It copies a short
 * instruction pointing the agent at the canonical .txt URL. That keeps
 * the UI stable while the prompt itself iterates — edits to the prompt
 * mean editing one file (`packages/landing/public/agent-prompt.txt`)
 * and re-deploying. No code change, no UI change.
 *
 * If you change `AGENT_PROMPT_URL` you also need to move the .txt file
 * to the new path under `packages/landing/public/` so the static-site
 * upload still serves it.
 */

export const AGENT_PROMPT_URL = 'https://agentfacets.io/agent-prompt.txt'

/**
 * Exact text the AgentPromptButton copies to the clipboard. Derived
 * from `AGENT_PROMPT_URL` via template string so the URL is referenced
 * once, not duplicated.
 */
export const AGENT_PROMPT_POINTER = `Please fetch and follow the instructions at ${AGENT_PROMPT_URL}`
