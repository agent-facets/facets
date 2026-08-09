import { expect, test } from 'bun:test'
import { type AssetTakeoverDecision, type AssetTakeoverRequest, assetIdentity } from '@agent-facets/engine'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { visibleTerminalText } from '../../../../../__tests__/helpers/terminal-output.ts'
import { AssetTakeoverScreen } from '../screen.tsx'

const KEY = { right: '\u001B[C', enter: '\r', escape: '\u001B', ctrlC: '\u0003' } as const

function request(overrides: Partial<AssetTakeoverRequest> = {}): AssetTakeoverRequest {
  return {
    facet: 'alpha',
    adapter: 'claude-code',
    asset: assetIdentity('project', 'skill', 'review'),
    authoredName: 'review',
    occupancy: 'divergent',
    ...overrides,
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

test('names the destination and selects Continue by default', async () => {
  const instance = render(createElement(AssetTakeoverScreen, { request: request(), onComplete: () => {} }))
  await tick()
  const text = visibleTerminalText(instance.lastFrame() ?? '')
  expect(text).toContain('claude-code')
  expect(text).toContain('project skill review')
  expect(text).toContain('wanted by alpha')
  // The marker, not the color, is what proves the default is Continue.
  expect(text).toContain('› Continue')
  instance.unmount()
})

test('an aliased asset names both the authored and effective name', async () => {
  const instance = render(
    createElement(AssetTakeoverScreen, {
      request: request({ authoredName: 'review', asset: assetIdentity('project', 'skill', 'team-review') }),
      onComplete: () => {},
    }),
  )
  await tick()
  expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('review → team-review')
  instance.unmount()
})

test('an equivalent destination says it is adopted rather than replaced', async () => {
  const instance = render(
    createElement(AssetTakeoverScreen, { request: request({ occupancy: 'equivalent' }), onComplete: () => {} }),
  )
  await tick()
  expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('adopts it without changing the file')
  instance.unmount()
})

test('enter with no navigation continues', async () => {
  const decisions: AssetTakeoverDecision[] = []
  const instance = render(
    createElement(AssetTakeoverScreen, { request: request(), onComplete: (d) => decisions.push(d) }),
  )
  await tick()
  instance.stdin.write(KEY.enter)
  await tick()
  expect(decisions).toEqual([{ kind: 'continue' }])
  instance.unmount()
})

test('moving to Cancel and confirming cancels', async () => {
  const decisions: AssetTakeoverDecision[] = []
  const instance = render(
    createElement(AssetTakeoverScreen, { request: request(), onComplete: (d) => decisions.push(d) }),
  )
  await tick()
  instance.stdin.write(KEY.right)
  await tick()
  instance.stdin.write(KEY.enter)
  await tick()
  expect(decisions).toEqual([{ kind: 'cancelled' }])
  instance.unmount()
})

// An interrupt is a request to stop, so it must not be answered by the
// default. Continuing here would write one more file on the way out.
test('ctrl-c cancels', async () => {
  const decisions: AssetTakeoverDecision[] = []
  const instance = render(
    createElement(AssetTakeoverScreen, { request: request(), onComplete: (d) => decisions.push(d) }),
  )
  await tick()
  instance.stdin.write(KEY.ctrlC)
  await tick()
  expect(decisions).toEqual([{ kind: 'cancelled' }])
  instance.unmount()
})

test('escape cancels', async () => {
  const decisions: AssetTakeoverDecision[] = []
  const instance = render(
    createElement(AssetTakeoverScreen, { request: request(), onComplete: (d) => decisions.push(d) }),
  )
  await tick()
  instance.stdin.write(KEY.escape)
  await tick()
  expect(decisions).toEqual([{ kind: 'cancelled' }])
  instance.unmount()
})
