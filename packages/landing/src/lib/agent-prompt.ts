/**
 * Single source of truth for the agent prompt: both the canonical hosted
 * URL and the full prompt body the AgentPromptButton copies to the
 * clipboard.
 *
 * The button copies the ENTIRE prompt body, not a pointer. Most agents
 * dislike being handed a "fetch this URL" redirect as their first
 * instruction (it reads like an unverified curl-pipe), so we paste the
 * real instructions directly. The body is inlined at build time via
 * Vite's `?raw` import of `packages/landing/src/agent-prompt.txt`.
 *
 * The same .txt file is also served at AGENT_PROMPT_URL: the
 * `agent-prompt` Vite plugin (vite/agent-prompt-plugin.ts) emits it to
 * `dist/agent-prompt.txt`, so the static-site upload serves it at the
 * apex. The prompt stays self-hosting — the body references its own
 * canonical location and docs can link to it.
 *
 * The file lives in `src/` (not `public/`) because Vite forbids `?raw`
 * imports from `public/`. Editing the prompt is still a single-file
 * edit: change the .txt and re-deploy. Vite re-bundles the inlined copy
 * and re-emits the hosted asset automatically.
 */

// `?raw` inlines the file contents as a string literal at build time.
import agentPromptBody from '../agent-prompt.txt?raw'

export const AGENT_PROMPT_URL = 'https://agentfacets.io/agent-prompt.txt'

/**
 * The full agent prompt the AgentPromptButton copies to the clipboard.
 * This is the verbatim contents of
 * `packages/landing/public/agent-prompt.txt`.
 */
export const AGENT_PROMPT_BODY = agentPromptBody
