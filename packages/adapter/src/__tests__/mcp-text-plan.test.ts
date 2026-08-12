import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerContribution, PrepareMcpServersRequest } from '../mcp-servers.ts'
import {
  applyMcpTextPlan,
  findInterpolationConflict,
  type McpTextPlan,
  type PrepareMcpTextPlanInput,
  prepareMcpTextPlan,
  type TextDocumentEdit,
} from '../mcp-text-plan.ts'

/**
 * The scaffolding every adapter composes, tested where it lives.
 *
 * These are the guarantees a third-party adapter author is entitled to assume
 * and cannot check themselves: that a guard fails closed regardless of the
 * pattern they hand it, and that an edit they render for a document they never
 * disclosed is refused before it can become an unrestorable write.
 */

function contribution(name: string, declaration: McpServerContribution['declaration']): McpServerContribution {
  return { name, declaration }
}

function stdio(command: string, args?: string[], env?: Record<string, string>): McpServerContribution['declaration'] {
  return { type: 'stdio', command, ...(args === undefined ? {} : { args }), ...(env === undefined ? {} : { env }) }
}

/**
 * A tool's interpolation syntax, assembled rather than written out so this
 * file does not itself contain the placeholder it is testing for.
 */
function interpolated(name: string): string {
  return `${'$'}{${name}}`
}

function request(desired: readonly McpServerContribution[]): PrepareMcpServersRequest {
  return { projectRoot: '/project', desired, previouslyOwnedNames: [] }
}

function planInput(overrides: Partial<PrepareMcpTextPlanInput> = {}): PrepareMcpTextPlanInput {
  return {
    request: request([contribution('fs', stdio('srv'))]),
    documentPaths: ['/project/a.json'],
    presentNames: new Set<string>(),
    compare: () => 'equivalent',
    buildEdits: () => ({
      ok: true,
      edits: [{ path: '/project/a.json', expected: null, contents: '{}\n' }],
    }),
    ...overrides,
  }
}

describe('findInterpolationConflict', () => {
  test('an interpolated literal names the server and the exact value', () => {
    const conflict = findInterpolationConflict(
      [contribution('fs', stdio('srv', [], { TOKEN: interpolated('SECRET') }))],
      {
        pattern: /\$\{[^}]*\}/,
      },
    )

    if (conflict === undefined) expect.unreachable()
    if (conflict.code !== 'conflict') expect.unreachable()
    if (conflict.reason !== 'interpolation') expect.unreachable()
    expect(conflict.serverName).toBe('fs')
    expect(conflict.value).toBe(interpolated('SECRET'))
  })

  test('the failure names no document', () => {
    // The guard runs before a write target is chosen, so any path it reported
    // would be a guess — and OpenCode's guess used to be a file it might never
    // write.
    const conflict = findInterpolationConflict([contribution('fs', stdio(interpolated('A')))], {
      pattern: /\$\{[^}]*\}/,
    })

    if (conflict === undefined) expect.unreachable()
    expect(conflict).toEqual({ code: 'conflict', reason: 'interpolation', serverName: 'fs', value: interpolated('A') })
  })

  test('a clean declaration produces no conflict', () => {
    expect(
      findInterpolationConflict([contribution('fs', stdio('srv', ['--root', '/w']))], { pattern: /\$\{[^}]*\}/ }),
    ).toBeUndefined()
  })

  test('a global pattern still catches every literal', () => {
    // `test` on a `/g` pattern advances `lastIndex`, so a shared object would
    // match, then miss, then match — a guard that fails open on alternate
    // values.
    const pattern = /\$\{[^}]*\}/g
    const desired = [
      contribution('a', stdio(interpolated('ONE'))),
      contribution('b', stdio(interpolated('TWO'))),
      contribution('c', stdio(interpolated('THREE'))),
    ]

    for (const single of desired) {
      const conflict = findInterpolationConflict([single], { pattern })
      if (conflict === undefined) expect.unreachable()
      if (conflict.code !== 'conflict' || conflict.reason !== 'interpolation') expect.unreachable()
      expect(conflict.serverName).toBe(single.name)
    }
  })

  test('a sticky pattern still catches a match past the start', () => {
    const conflict = findInterpolationConflict([contribution('fs', stdio(`prefix-${interpolated('A')}`))], {
      pattern: /\$\{[^}]*\}/y,
    })
    if (conflict === undefined) expect.unreachable()
    if (conflict.code !== 'conflict' || conflict.reason !== 'interpolation') expect.unreachable()
    expect(conflict.value).toBe(`prefix-${interpolated('A')}`)
  })

  test("the caller's pattern is left as it was found", () => {
    const pattern = /\$\{[^}]*\}/g
    findInterpolationConflict([contribution('fs', stdio(interpolated('A')))], { pattern })
    expect(pattern.lastIndex).toBe(0)
  })

  test('flags that change what the source means are preserved', () => {
    // `u` alters escape semantics, so dropping it would change which values
    // match. Only `g` and `y` are removed.
    const conflict = findInterpolationConflict([contribution('fs', stdio('\u{1f600}'))], { pattern: /\p{Emoji}/gu })
    if (conflict === undefined) expect.unreachable()
    if (conflict.code !== 'conflict' || conflict.reason !== 'interpolation') expect.unreachable()
    expect(conflict.value).toBe('\u{1f600}')
  })
})

describe('prepareMcpTextPlan', () => {
  test('an interpolation conflict is returned before anything is classified', () => {
    const result = prepareMcpTextPlan(
      planInput({
        request: request([contribution('fs', stdio('srv', [], { TOKEN: '{env:SECRET}' }))]),
        interpolation: { pattern: /\{env:[^}]*\}/ },
        compare: () => expect.unreachable(),
      }),
    )

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'conflict' || result.failure.reason !== 'interpolation') expect.unreachable()
    expect(result.failure.value).toBe('{env:SECRET}')
  })

  test('an undisclosed edit is refused rather than planned', () => {
    expect(() =>
      prepareMcpTextPlan(
        planInput({
          presentNames: new Set(['fs']),
          compare: () => 'divergent',
          buildEdits: () => ({
            ok: true,
            edits: [{ path: '/project/elsewhere.json', expected: null, contents: '{}\n' }],
          }),
        }),
      ),
    ).toThrow(/undisclosed document/)
  })

  test('a disclosed subset of the documents is accepted', () => {
    const result = prepareMcpTextPlan(
      planInput({
        documentPaths: ['/project/a.json', '/project/b.json'],
        presentNames: new Set(['fs']),
        compare: () => 'divergent',
        buildEdits: () => ({
          ok: true,
          edits: [{ path: '/project/b.json', expected: null, contents: '{}\n' }],
        }),
      }),
    )

    if (!result.ok) expect.unreachable()
    const plan = result.preparation.plan
    if (plan.kind !== 'write') expect.unreachable()
    expect(plan.edits.map((edit: TextDocumentEdit) => edit.path)).toEqual(['/project/b.json'])
  })

  test('every disclosed document may be edited at once', () => {
    const result = prepareMcpTextPlan(
      planInput({
        documentPaths: ['/project/a.json', '/project/b.json'],
        presentNames: new Set(['fs']),
        compare: () => 'divergent',
        buildEdits: () => ({
          ok: true,
          edits: [
            { path: '/project/a.json', expected: null, contents: '{}\n' },
            { path: '/project/b.json', expected: null, contents: '{}\n' },
          ],
        }),
      }),
    )

    if (!result.ok) expect.unreachable()
    expect(result.preparation.documentPaths).toEqual(['/project/a.json', '/project/b.json'])
  })

  test('nothing to write short-circuits before edits are built', () => {
    const result = prepareMcpTextPlan(
      planInput({
        presentNames: new Set(['fs']),
        compare: () => 'equivalent',
        buildEdits: () => expect.unreachable(),
      }),
    )

    if (!result.ok) expect.unreachable()
    expect(result.preparation.plan.kind).toBe('unchanged')
  })
})

describe('applyMcpTextPlan', () => {
  test('a drifted document is reported by path alone', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'adapter-text-plan-'))
    try {
      const path = join(directory, 'doc.json')
      writeFileSync(path, 'current\n')
      const plan: McpTextPlan = {
        kind: 'write',
        documentPaths: [path],
        edits: [{ path, expected: 'inspected\n', contents: 'desired\n' }],
      }

      const applied = await applyMcpTextPlan(plan, { adapterName: 'test' })

      if (applied.ok) expect.unreachable()
      expect(applied.failure).toEqual({ code: 'conflict', reason: 'document-changed', path })
      expect(await Bun.file(path).text()).toBe('current\n')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('a plan carrying an undisclosed edit is not a plan this SDK produced', async () => {
    // The opaque plan crosses a boundary the type system cannot follow, so the
    // disclosure invariant is re-established on the way back in.
    const forged = {
      kind: 'write',
      documentPaths: ['/project/a.json'],
      edits: [{ path: '/project/elsewhere.json', expected: null, contents: '{}\n' }],
    }

    await expect(applyMcpTextPlan(forged, { adapterName: 'test' })).rejects.toThrow(/did not produce/)
  })
})
