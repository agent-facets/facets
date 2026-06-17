import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { useEffect } from 'react'
import { FormStateProvider, useFormState } from '../form-state-context.ts'

/**
 * Applies privacy steps once on mount, then reports `toCreateOptions()` on
 * every render. Reading on each render (rather than inside the mutating
 * effect) lets the assertion observe the settled form state after React
 * flushes the `setPrivate` updates.
 */
function Probe({ steps, report }: { steps: boolean[]; report: (hasPrivate: boolean) => void }) {
  const { setPrivate, toCreateOptions } = useFormState()
  useEffect(() => {
    for (const step of steps) setPrivate(step)
  }, [setPrivate, steps])
  report('private' in toCreateOptions())
  return null
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function runSteps(steps: boolean[]): Promise<boolean> {
  let hasPrivate = false
  const instance = render(
    <FormStateProvider>
      <Probe steps={steps} report={(v) => (hasPrivate = v)} />
    </FormStateProvider>,
  )
  await nextTick()
  instance.unmount()
  return hasPrivate
}

describe('toCreateOptions privacy', () => {
  test('default (public) omits private', async () => {
    expect(await runSteps([])).toBe(false)
  })

  test('selecting private includes private: true', async () => {
    expect(await runSteps([true])).toBe(true)
  })

  test('private then reverted to public omits private', async () => {
    expect(await runSteps([true, false])).toBe(false)
  })
})
