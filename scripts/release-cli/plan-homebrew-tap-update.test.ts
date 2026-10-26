import { expect, test } from 'bun:test'
import { planHomebrewTapUpdate } from './plan-homebrew-tap-update'

const formula = (version: string) => ({ version, content: `formula ${version}` })

test('creates one deterministic update and supersedes lower pending versions', () => {
  expect(
    planHomebrewTapUpdate({
      formula: formula('1.2.0'),
      defaultFormula: formula('1.0.0'),
      openUpdates: [
        { number: 12, branch: 'homebrew/facet-1.1.0', ...formula('1.1.0') },
        { number: 13, branch: 'homebrew/facet-1.2.1', ...formula('1.2.1') },
      ],
    }),
  ).toEqual({ ok: true, kind: 'create', branch: 'homebrew/facet-1.2.0', supersede: [12] })
})

test('reuses an identical version PR and refuses unexpected content', () => {
  const update = { number: 12, branch: 'homebrew/facet-1.2.0', ...formula('1.2.0') }
  expect(
    planHomebrewTapUpdate({ formula: formula('1.2.0'), defaultFormula: formula('1.0.0'), openUpdates: [update] }),
  ).toEqual({
    ok: true,
    kind: 'reuse',
    pullRequest: 12,
    supersede: [],
  })
  expect(
    planHomebrewTapUpdate({
      formula: { version: '1.2.0', content: 'unexpected' },
      defaultFormula: formula('1.0.0'),
      openUpdates: [update],
    }),
  ).toEqual({ ok: false, code: 'remote-drift', pullRequest: 12 })
})

test('does not modify an applied version and refuses downgrades or malformed versions', () => {
  expect(
    planHomebrewTapUpdate({ formula: formula('1.2.0'), defaultFormula: formula('1.2.0'), openUpdates: [] }),
  ).toEqual({
    ok: true,
    kind: 'already-applied',
  })
  expect(
    planHomebrewTapUpdate({ formula: formula('1.1.0'), defaultFormula: formula('1.2.0'), openUpdates: [] }),
  ).toEqual({
    ok: false,
    code: 'downgrade',
    currentVersion: '1.2.0',
  })
  expect(planHomebrewTapUpdate({ formula: formula('latest'), defaultFormula: null, openUpdates: [] })).toEqual({
    ok: false,
    code: 'invalid-version',
    version: 'latest',
  })
})
