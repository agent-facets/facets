import { describe, expect, test } from 'bun:test'
import {
  type EditContext,
  type EditOperation,
  type EditResult,
  type ReadmeAction,
  type ReadmeFileState,
  type ReadmePath,
  readmeActionFor,
} from '@agent-facets/engine'
import type { FacetManifest } from '@agent-facets/protocol'
import { render } from 'ink-testing-library'
import { useEffect } from 'react'
import { manifestToFormState } from '../manifest-to-form.ts'
import { useEditSession } from '../use-edit-session.ts'

/**
 * Drives README resolutions on mount, then reports the operations `buildResult`
 * produces so assertions observe the settled edit output. README bytes and
 * declarations are derived purely from the queued actions — this exercises the
 * `use-edit-session` wiring that the dedicated README panel drives.
 */
function Probe({
  context,
  steps,
  report,
}: {
  context: EditContext
  steps: (resolveReadme: (path: ReadmePath, action: ReadmeAction) => void) => void
  report: (r: EditResult) => void
}) {
  const { resolveReadme, buildResult } = useEditSession(context)
  useEffect(() => {
    steps(resolveReadme)
  }, [steps, resolveReadme])
  report(buildResult(manifestToFormState(context.manifest)))
  return null
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function run(
  context: EditContext,
  steps: (resolveReadme: (path: ReadmePath, action: ReadmeAction) => void) => void,
): Promise<EditOperation[]> {
  let result: EditResult = { outcome: 'cancelled' } as EditResult
  const instance = render(<Probe context={context} steps={steps} report={(r) => (result = r)} />)
  await nextTick()
  instance.unmount()
  if (result.outcome !== 'applied') expect.unreachable()
  return result.operations
}

/** Build an EditContext with the given manifest and README panel states. */
function contextWith(manifest: FacetManifest, readme: ReadmeFileState[]): EditContext {
  return { rootDir: '/tmp/facet', manifest, reconciliationItems: [], readme }
}

/** The manifest inside the queued `write-manifest` operation. */
function finalManifest(operations: EditOperation[]): FacetManifest {
  const op = operations.find((o) => o.op === 'write-manifest')
  if (op?.op !== 'write-manifest') expect.unreachable()
  return op.manifest
}

const BASE: FacetManifest = { name: 'demo', version: '1.0.0' }

describe('edit README session wiring', () => {
  test('adopt adds the declaration and writes no README file (preserves bytes)', async () => {
    const ctx = contextWith(BASE, [{ path: 'README.md', state: 'present-undeclared', content: '# on disk' }])
    const ops = await run(ctx, (resolveReadme) => {
      resolveReadme('README.md', readmeActionFor('adopt', ''))
    })
    // No file op — on-disk bytes are untouched.
    expect(ops.some((o) => o.op === 'write-file' || o.op === 'delete-file')).toBe(false)
    expect(finalManifest(ops).files).toEqual(['README.md'])
  })

  test('create queues a write-file and adds the declaration', async () => {
    const ctx = contextWith(BASE, [{ path: 'README.md', state: 'absent-undeclared' }])
    const ops = await run(ctx, (resolveReadme) => {
      resolveReadme('README.md', readmeActionFor('create', '# new\n'))
    })
    expect(ops).toContainEqual({ op: 'write-file', path: 'README.md', content: '# new\n' })
    expect(finalManifest(ops).files).toEqual(['README.md'])
  })

  test('remove queues delete-file and drops the declaration', async () => {
    const declared: FacetManifest = { ...BASE, files: ['README.md'] }
    const ctx = contextWith(declared, [{ path: 'README.md', state: 'present-declared', content: '# old' }])
    const ops = await run(ctx, (resolveReadme) => {
      resolveReadme('README.md', readmeActionFor('remove', ''))
    })
    expect(ops).toContainEqual({ op: 'delete-file', path: 'README.md' })
    expect('files' in finalManifest(ops)).toBe(false)
  })

  test('scaffold at the exact declared path writes bytes; declaration stays', async () => {
    const declared: FacetManifest = { ...BASE, files: ['README'] }
    const ctx = contextWith(declared, [{ path: 'README', state: 'declared-missing' }])
    const ops = await run(ctx, (resolveReadme) => {
      resolveReadme('README', readmeActionFor('scaffold', '# t\n'))
    })
    expect(ops).toContainEqual({ op: 'write-file', path: 'README', content: '# t\n' })
    expect(finalManifest(ops).files).toEqual(['README'])
  })

  test('the two conventional paths are managed independently', async () => {
    // README.md present+undeclared → adopt; README absent → create.
    const ctx = contextWith(BASE, [
      { path: 'README.md', state: 'present-undeclared', content: '# md' },
      { path: 'README', state: 'absent-undeclared' },
    ])
    const ops = await run(ctx, (resolveReadme) => {
      resolveReadme('README.md', readmeActionFor('adopt', ''))
      resolveReadme('README', readmeActionFor('create', '# plain\n'))
    })
    // Only the created path writes a file; adoption writes nothing.
    expect(ops.filter((o) => o.op === 'write-file')).toEqual([
      { op: 'write-file', path: 'README', content: '# plain\n' },
    ])
    // Both paths end up declared, independently.
    expect(finalManifest(ops).files).toEqual(['README', 'README.md'])
  })

  test('a path left as-is (no action) queues no README change', async () => {
    const ctx = contextWith(BASE, [{ path: 'README.md', state: 'present-undeclared', content: '# on disk' }])
    const ops = await run(ctx, () => {
      // No resolveReadme call — the author leaves README alone.
    })
    expect(ops).toEqual([{ op: 'write-manifest', manifest: BASE }])
  })
})
