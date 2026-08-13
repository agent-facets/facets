import { describe, expect, test } from 'bun:test'
import { regularFile } from '@agent-facets/common'
import type { McpServerContribution, PlanMcpServersRequest } from '../mcp-servers.ts'
import {
  findInterpolationConflict,
  type McpTextDocument,
  type PrepareMcpTextPlanInput,
  prepareMcpTextPlan,
} from '../mcp-text-plan.ts'

/**
 * The scaffolding every adapter composes, tested where it lives.
 *
 * These are the guarantees a third-party adapter author is entitled to assume
 * and cannot check themselves: that a guard fails closed regardless of the
 * pattern they hand it, and that an edit they render for a document they never
 * inspected is refused before it can become an unrestorable write.
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

function request(desired: readonly McpServerContribution[]): PlanMcpServersRequest {
  return { projectRoot: '/project', desired, previouslyOwnedNames: [] }
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

function document(path: string, contents?: string): McpTextDocument {
  return { path, state: contents === undefined ? { kind: 'absent' } : regularFile(encode(contents), 0o644) }
}

function planInput(overrides: Partial<PrepareMcpTextPlanInput> = {}): PrepareMcpTextPlanInput {
  return {
    request: request([contribution('fs', stdio('srv'))]),
    documents: [document('/project/a.json')],
    presentNames: new Set<string>(),
    compare: () => 'equivalent',
    buildEdits: () => ({ ok: true, edits: [{ path: '/project/a.json', contents: '{}\n' }] }),
    ...overrides,
  }
}

describe('findInterpolationConflict', () => {
  test('an interpolated literal names the server and the exact value', () => {
    const conflict = findInterpolationConflict(
      [contribution('fs', stdio('srv', [], { TOKEN: interpolated('SECRET') }))],
      { pattern: /\$\{[^}]*\}/ },
    )

    if (conflict === undefined) expect.unreachable()
    if (conflict.code !== 'conflict') expect.unreachable()
    if (conflict.reason !== 'interpolation') expect.unreachable()
    expect(conflict.serverName).toBe('fs')
    expect(conflict.value).toBe(interpolated('SECRET'))
  })

  test('the failure names no document', () => {
    // The guard runs before a write target is chosen, so any path it reported
    // would be a guess.
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

  test('an edit for an uninspected document is refused rather than planned', () => {
    expect(() =>
      prepareMcpTextPlan(
        planInput({
          presentNames: new Set(['fs']),
          compare: () => 'divergent',
          buildEdits: () => ({ ok: true, edits: [{ path: '/project/elsewhere.json', contents: '{}\n' }] }),
        }),
      ),
    ).toThrow(/uninspected document/)
  })

  test('a mutation carries the exact state its document was inspected in', () => {
    const result = prepareMcpTextPlan(
      planInput({
        documents: [document('/project/a.json', '{"mcp":{}}\n')],
        presentNames: new Set(['fs']),
        compare: () => 'divergent',
        buildEdits: () => ({ ok: true, edits: [{ path: '/project/a.json', contents: '{"mcp":{"fs":{}}}\n' }] }),
      }),
    )

    if (!result.ok) expect.unreachable()
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    const [mutation] = result.plan.action.mutations
    if (mutation.expected.kind !== 'regular-file') expect.unreachable()
    expect(new TextDecoder().decode(mutation.expected.contents)).toBe('{"mcp":{}}\n')
    expect(mutation.boundary).toBe('/project')
  })

  test('several inspected documents may be edited as one batch', () => {
    const result = prepareMcpTextPlan(
      planInput({
        documents: [document('/project/a.json'), document('/project/b.json')],
        presentNames: new Set(['fs']),
        compare: () => 'divergent',
        buildEdits: () => ({
          ok: true,
          edits: [
            { path: '/project/a.json', contents: 'a\n' },
            { path: '/project/b.json', contents: 'b\n' },
          ],
        }),
      }),
    )

    if (!result.ok) expect.unreachable()
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    expect(result.plan.action.mutations.map((mutation) => mutation.path)).toEqual([
      '/project/a.json',
      '/project/b.json',
    ])
  })

  test('an edit whose rendered text matches the document is dropped', () => {
    // Adapters re-render a whole layer to change one entry. Writing identical
    // bytes back would journal a transition this run never made.
    const result = prepareMcpTextPlan(
      planInput({
        documents: [document('/project/a.json', 'same\n'), document('/project/b.json', 'old\n')],
        presentNames: new Set(['fs']),
        compare: () => 'divergent',
        buildEdits: () => ({
          ok: true,
          edits: [
            { path: '/project/a.json', contents: 'same\n' },
            { path: '/project/b.json', contents: 'new\n' },
          ],
        }),
      }),
    )

    if (!result.ok) expect.unreachable()
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    expect(result.plan.action.mutations.map((mutation) => mutation.path)).toEqual(['/project/b.json'])
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
    expect(result.plan.action.kind).toBe('unchanged')
  })

  test('outcomes survive even when every rendered edit turns out to be a no-op', () => {
    const result = prepareMcpTextPlan(
      planInput({
        documents: [document('/project/a.json', 'identical\n')],
        presentNames: new Set(['fs']),
        compare: () => 'divergent',
        buildEdits: () => ({ ok: true, edits: [{ path: '/project/a.json', contents: 'identical\n' }] }),
      }),
    )

    if (!result.ok) expect.unreachable()
    expect(result.plan.action.kind).toBe('unchanged')
    expect(result.plan.outcomes.map((outcome) => outcome.kind)).toEqual(['divergent'])
  })
})
