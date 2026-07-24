import { describe, expect, test } from 'bun:test'
import type { ScaffoldReadme } from '@agent-facets/engine'
import { render } from 'ink-testing-library'
import { useEffect } from 'react'
import { FormStateProvider, useFormState } from '../form-state-context.ts'

/**
 * Drives a sequence of form mutations on mount, then reports the narrowed
 * `toCreateOptions().readme` on every render so assertions observe the settled
 * state after React flushes updates.
 */
function Probe({
  steps,
  report,
}: {
  steps: (ctx: ReturnType<typeof useFormState>) => void
  report: (r: ScaffoldReadme) => void
}) {
  const ctx = useFormState()
  useEffect(() => {
    steps(ctx)
  }, [steps, ctx])
  report(ctx.toCreateOptions().readme)
  return null
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function run(steps: (ctx: ReturnType<typeof useFormState>) => void): Promise<ScaffoldReadme> {
  let result: ScaffoldReadme = { kind: 'disabled' }
  const instance = render(
    <FormStateProvider>
      <Probe steps={steps} report={(r) => (result = r)} />
    </FormStateProvider>,
  )
  await nextTick()
  instance.unmount()
  return result
}

describe('create README form state', () => {
  test('README is enabled by default', async () => {
    const readme = await run(() => {})
    expect(readme.kind).toBe('enabled')
  })

  test('seeded content re-seeds from identity edits', async () => {
    const readme = await run((ctx) => {
      ctx.setFieldValue('name', 'my-facet')
      ctx.setFieldValue('description', 'Neat tools')
    })
    if (readme.kind !== 'enabled') expect.unreachable()
    expect(readme.content).toBe('# my-facet\n\nNeat tools\n')
  })

  test('authored content is preserved across later identity edits', async () => {
    const readme = await run((ctx) => {
      ctx.setFieldValue('name', 'my-facet')
      ctx.setReadmeContent('# Custom\n\nHand-written docs.\n')
      // A later identity edit MUST NOT regenerate the authored content.
      ctx.setFieldValue('name', 'renamed')
    })
    if (readme.kind !== 'enabled') expect.unreachable()
    expect(readme.content).toBe('# Custom\n\nHand-written docs.\n')
  })

  test('disable then re-enable preserves the draft', async () => {
    const readme = await run((ctx) => {
      ctx.setReadmeContent('# Kept\n')
      ctx.setReadmeEnabled(false)
      ctx.setReadmeEnabled(true)
    })
    if (readme.kind !== 'enabled') expect.unreachable()
    expect(readme.content).toBe('# Kept\n')
  })

  test('disabled narrows to a disabled scaffold option', async () => {
    const readme = await run((ctx) => {
      ctx.setReadmeEnabled(false)
    })
    expect(readme).toEqual({ kind: 'disabled' })
  })
})
