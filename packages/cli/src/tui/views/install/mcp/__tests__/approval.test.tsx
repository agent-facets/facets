import { expect, test } from 'bun:test'
import type { McpConsentDecision, McpConsentRequest } from '@agent-facets/engine'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { visibleTerminalText } from '../../../../../__tests__/helpers/terminal-output.ts'
import { McpApprovalScreen } from '../approval.tsx'

const REQUEST: McpConsentRequest = {
  declarations: [
    {
      identity: { kind: 'mcp-server', effectiveName: 'filesystem' },
      fingerprint: `sha256:${'a'.repeat(64)}`,
      declaration: { type: 'stdio', command: 'npx', args: ['-y', 'srv'], env: { TOKEN_NAME: 'A' } },
      claimants: [{ facet: 'alpha', authoredName: 'filesystem', disposition: { kind: 'authored' } }],
      standing: { kind: 'unknown-identity' },
    },
  ],
  takeovers: [
    {
      adapter: 'claude-code',
      identity: { kind: 'mcp-server', effectiveName: 'docs' },
      existing: 'divergent',
      declaration: { type: 'http', url: 'https://mcp.example.com/mcp' },
    },
  ],
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

test('shows both sections with full declarations', async () => {
  const instance = render(createElement(McpApprovalScreen, { request: REQUEST, onComplete: () => {} }))
  await tick()
  const text = visibleTerminalText(instance.lastFrame() ?? '')
  expect(text).toContain('stdio npx -y srv')
  expect(text).toContain('env TOKEN_NAME=A')
  expect(text).toContain('http https://mcp.example.com/mcp')
  expect(text).toContain('claude-code: docs differs and would be replaced')
  expect(text).toContain('Decline')
  expect(text).toContain('Approve all')
  instance.unmount()
})

test('enter with no navigation declines', async () => {
  const decisions: McpConsentDecision[] = []
  const instance = render(createElement(McpApprovalScreen, { request: REQUEST, onComplete: (d) => decisions.push(d) }))
  await tick()
  instance.stdin.write('\r')
  await tick()
  expect(decisions).toEqual([{ kind: 'declined' }])
  instance.unmount()
})

test('moving to approve and confirming approves', async () => {
  const decisions: McpConsentDecision[] = []
  const instance = render(createElement(McpApprovalScreen, { request: REQUEST, onComplete: (d) => decisions.push(d) }))
  await tick()
  instance.stdin.write('\u001B[C')
  await tick()
  instance.stdin.write('\r')
  await tick()
  expect(decisions).toEqual([{ kind: 'approved' }])
  instance.unmount()
})
