import { describe, expect, test } from 'bun:test'
import { resolveHomebrewInstall } from '../homebrew.ts'

const formula = 'agent-facets/tap/facet'
const root = '/opt/homebrew'
const formulaPrefix = `${root}/Cellar/facet/0.36.6`

function runFor(options: { root?: string | null; prefix?: string | null }) {
  return async (command: string[]) => {
    if (command.join(' ') === 'brew --prefix') return options.root === undefined ? root : options.root
    if (command.join(' ') === `brew --prefix --installed ${formula}`) {
      return options.prefix === undefined ? formulaPrefix : options.prefix
    }
    return null
  }
}

describe('resolveHomebrewInstall', () => {
  test('verifies the running binary against the installed official formula prefix', async () => {
    const binary = `${formulaPrefix}/bin/facet`

    const result = await resolveHomebrewInstall({
      execPath: '/opt/homebrew/bin/facet',
      realpath: (path) => (path === '/opt/homebrew/bin/facet' ? binary : path),
      run: runFor({}),
    })

    expect(result).toEqual({ kind: 'verified', formula })
  })

  test('does not claim an unrelated binary merely because Homebrew is installed', async () => {
    const result = await resolveHomebrewInstall({
      execPath: '/usr/local/bin/facet',
      realpath: (path) => path,
      run: runFor({}),
    })

    expect(result).toEqual({ kind: 'not-homebrew' })
  })

  test('does not claim a different Homebrew formula as the official tap', async () => {
    const result = await resolveHomebrewInstall({
      execPath: '/opt/homebrew/bin/facet',
      realpath: (path) =>
        path === '/opt/homebrew/bin/facet' ? '/opt/homebrew/Cellar/another-facet/1.0.0/bin/facet' : path,
      run: runFor({}),
    })

    expect(result).toEqual({ kind: 'guidance', reason: 'different-formula' })
  })

  test('keeps a Cellar binary out of installer fallback when formula metadata is unavailable', async () => {
    const result = await resolveHomebrewInstall({
      execPath: '/opt/homebrew/Cellar/facet/0.36.6/bin/facet',
      realpath: (path) => path,
      run: runFor({ prefix: null }),
    })

    expect(result).toEqual({ kind: 'guidance', reason: 'metadata-unavailable' })
  })

  test('uses a custom Homebrew prefix', async () => {
    const customRoot = '/custom/brew'
    const customPrefix = `${customRoot}/Cellar/facet/0.36.6`
    const result = await resolveHomebrewInstall({
      execPath: `${customRoot}/bin/facet`,
      realpath: (path) => (path === `${customRoot}/bin/facet` ? `${customPrefix}/bin/facet` : path),
      run: runFor({ root: customRoot, prefix: customPrefix }),
    })

    expect(result).toEqual({ kind: 'verified', formula })
  })

  test('does not claim ownership when Homebrew is unavailable', async () => {
    const result = await resolveHomebrewInstall({
      execPath: '/opt/homebrew/bin/facet',
      realpath: (path) => path,
      run: runFor({ root: null }),
    })

    expect(result).toEqual({ kind: 'not-homebrew' })
  })

  test('uses guidance when a Homebrew-shaped path cannot be resolved', async () => {
    const result = await resolveHomebrewInstall({
      execPath: '/opt/homebrew/Cellar/facet/0.36.6/bin/facet',
      realpath: () => {
        throw new Error('missing')
      },
      run: runFor({}),
    })

    expect(result).toEqual({ kind: 'guidance', reason: 'metadata-unavailable' })
  })
})
