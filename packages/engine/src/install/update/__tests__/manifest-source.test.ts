import { describe, expect, test } from 'bun:test'
import { parseVersionSpec } from '../../../sources/facet/parse-version.ts'
import { finalManifestSource, type UpdateChoice } from '../manifest-source.ts'
import { parseExactVersion } from '../version-order.ts'

/** Build the authored specifier from the text a user would have written. */
function authored(source: string) {
  const spec = parseVersionSpec(source)
  if (!spec.ok) expect.unreachable()
  return { source, spec: spec.value }
}

function rewrite(source: string, choice: UpdateChoice, selected: string): string {
  const version = parseExactVersion(selected)
  if (version === undefined) expect.unreachable()
  return finalManifestSource({ authored: authored(source), choice, selected: version })
}

describe('finalManifestSource — choosing the range target', () => {
  test.each(['1.2.0', '1.*', '1.2.*', '*', 'latest'])('leaves the authored form %p untouched', (source) => {
    expect(rewrite(source, 'range', '1.8.0')).toBe(source)
  })
})

describe('finalManifestSource — choosing latest', () => {
  test('an exact pin becomes the selected version', () => {
    expect(rewrite('1.2.0', 'latest', '2.4.1')).toBe('2.4.1')
  })

  test('a major wildcard advances its major and stays a major wildcard', () => {
    expect(rewrite('1.*', 'latest', '2.4.1')).toBe('2.*')
  })

  test('a minor wildcard advances major and minor and stays a minor wildcard', () => {
    expect(rewrite('1.2.*', 'latest', '2.4.1')).toBe('2.4.*')
  })

  test('a bare wildcard already floats, so nothing is rewritten', () => {
    expect(rewrite('*', 'latest', '2.4.1')).toBe('*')
  })

  test('the latest tag keeps its spelling rather than becoming a wildcard', () => {
    // `*` and `latest` resolve identically but are distinct authored
    // forms; rewriting one into the other would edit a file the user
    // never asked to have reworded.
    expect(rewrite('latest', 'latest', '2.4.1')).toBe('latest')
  })

  test('widening within the same major keeps the wildcard shape', () => {
    expect(rewrite('1.*', 'latest', '1.9.0')).toBe('1.*')
    expect(rewrite('1.2.*', 'latest', '1.2.9')).toBe('1.2.*')
  })
})
