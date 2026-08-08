import { describe, expect, test } from 'bun:test'
import type { MaterializationCollisionGroup, StaleMaterializationOverride } from '@agent-facets/engine'
import type { CollisionGroup } from '@agent-facets/protocol'
import { formatCollisionReport, manifestLocation, PLACEHOLDER_ALIAS } from '../collision-report.ts'

/** Tag asset-domain fixtures for the cross-domain report. */
function assetGroups(...groups: CollisionGroup[]): MaterializationCollisionGroup[] {
  return groups.map((group) => ({ kind: 'asset', group }))
}

const TWO_WAY: CollisionGroup[] = [
  {
    scope: 'project',
    namespace: 'skill-command',
    effectiveName: 'review',
    members: [
      {
        facet: 'alpha',
        scope: 'project',
        type: 'skill',
        authoredName: 'review',
        effectiveName: 'review',
        disposition: { kind: 'authored' },
      },
      {
        facet: 'beta',
        scope: 'project',
        type: 'command',
        authoredName: 'review',
        effectiveName: 'review',
        disposition: { kind: 'authored' },
      },
    ],
  },
]

const SECOND_GROUP: CollisionGroup = {
  scope: 'project',
  namespace: 'agent',
  effectiveName: 'auditor',
  members: [
    {
      facet: 'alpha',
      scope: 'project',
      type: 'agent',
      authoredName: 'auditor',
      effectiveName: 'auditor',
      disposition: { kind: 'authored' },
    },
    {
      facet: 'gamma',
      scope: 'project',
      type: 'agent',
      authoredName: 'checker',
      effectiveName: 'auditor',
      disposition: { kind: 'aliased', as: 'auditor' },
    },
  ],
}

describe('manifestLocation', () => {
  test('points at the typed override map for the asset', () => {
    expect(manifestLocation('alpha', 'skill', 'review')).toBe('facets["alpha"].materialization.skills["review"]')
    expect(manifestLocation('alpha', 'command', 'deploy')).toBe('facets["alpha"].materialization.commands["deploy"]')
    expect(manifestLocation('alpha', 'agent', 'auditor')).toBe('facets["alpha"].materialization.agents["auditor"]')
  })

  test('quotes names that would otherwise break the path', () => {
    // Legacy asset names are path-safe but not necessarily
    // identifier-safe; JSON quoting keeps the location copy-pasteable.
    expect(manifestLocation('my.facet', 'skill', 'a-b.c')).toBe('facets["my.facet"].materialization.skills["a-b.c"]')
  })
})

describe('formatCollisionReport', () => {
  test('names every group and every claimant', () => {
    const report = formatCollisionReport(assetGroups(...TWO_WAY, SECOND_GROUP), [])

    expect(report).toContain('"review"')
    expect(report).toContain('"auditor"')
    for (const facet of ['alpha', 'beta', 'gamma']) expect(report).toContain(facet)
    // Both sides of both groups, including the already-aliased claimant.
    expect(report).toContain('checker')
    expect(report).toContain('already aliased from "checker"')
  })

  test('gives every claimant its own manifest location', () => {
    const report = formatCollisionReport(assetGroups(...TWO_WAY), [])

    expect(report).toContain('facets["alpha"].materialization.skills["review"]')
    expect(report).toContain('facets["beta"].materialization.commands["review"]')
  })

  test('offers an alias and an omission snippet for each claimant', () => {
    const report = formatCollisionReport(assetGroups(...TWO_WAY), [])
    const aliasLines = report.split('\n').filter((line) => line.includes('"kind": "aliased"'))
    const omitLines = report.split('\n').filter((line) => line.includes('"kind": "omitted"'))

    expect(aliasLines.length).toBeGreaterThanOrEqual(2)
    expect(omitLines.length).toBeGreaterThanOrEqual(2)
  })

  test('the snippets it prints are parseable JSON', () => {
    const report = formatCollisionReport(assetGroups(...TWO_WAY), [])
    const snippets = report
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('alias:') || line.startsWith('omit:'))
      .map((line) => line.replace(/^(alias|omit):\s*/, ''))

    expect(snippets.length).toBeGreaterThanOrEqual(4)
    for (const snippet of snippets) {
      // A snippet a user cannot paste is worse than no snippet: it looks
      // authoritative and then fails schema validation.
      expect(() => JSON.parse(`{ ${snippet} }`)).not.toThrow()
    }
  })

  test('the example alias satisfies the asset-name grammar', () => {
    // The spec requires syntactically valid examples, so the placeholder
    // cannot be something like `<your-name>`.
    expect(PLACEHOLDER_ALIAS).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(formatCollisionReport(assetGroups(...TWO_WAY), [])).toContain(PLACEHOLDER_ALIAS)
  })

  test('does not prefer a claimant or invent a resolution', () => {
    const report = formatCollisionReport(assetGroups(...TWO_WAY), []).toLowerCase()

    for (const word of ['winner', 'preferred', 'takes precedence', 'wins', 'recommend']) {
      expect(report).not.toContain(word)
    }
    // Both claimants get exactly the same two options, so nothing in the
    // text implies which one should yield.
    //
    // The snippets sit on their own `alias:` / `omit:` lines BELOW the
    // claimant's `• <facet>:` line, so no single line contains both the facet
    // name and `"kind"`. Counting lines that contain both made each side zero
    // and the assertion vacuously true; slicing each claimant's own section
    // is what actually compares the two.
    const sections = claimantSections(report)
    expect(Object.keys(sections).sort()).toEqual(['alpha', 'beta'])
    for (const [facet, section] of Object.entries(sections)) {
      expect(section.filter((line) => line.includes('"kind": "aliased"'))).toHaveLength(1)
      expect(section.filter((line) => line.includes('"kind": "omitted"'))).toHaveLength(1)
      expect(facet).toBeTruthy()
    }
  })

  /** Split the report into each claimant's own block of lines. */
  function claimantSections(report: string): Record<string, string[]> {
    const sections: Record<string, string[]> = {}
    let current: string[] | null = null
    for (const line of report.split('\n')) {
      const claimant = /^\s*• ([^:]+):/.exec(line)
      if (claimant?.[1] !== undefined) {
        current = []
        sections[claimant[1]] = current
        continue
      }
      // A claimant's block ends at the next claimant or the next unindented
      // paragraph.
      if (current !== null && line.trim().length === 0) current = null
      else current?.push(line)
    }
    return sections
  }

  test('states that nothing was changed', () => {
    const report = formatCollisionReport(assetGroups(...TWO_WAY), [])

    expect(report).toContain('facets.json')
    expect(report).toContain('facets.lock')
    expect(report).toContain('receipt')
    expect(report).toContain('NOT changed')
  })

  test('explains that skills and commands share one namespace', () => {
    // Without this, a skill colliding with a command reads as a bug.
    expect(formatCollisionReport(assetGroups(...TWO_WAY), [])).toContain('skills and commands')
    expect(formatCollisionReport(assetGroups(SECOND_GROUP), [])).toContain('project agents')
  })

  test('lists stale overrides when there are any', () => {
    const stale: StaleMaterializationOverride[] = [
      {
        facet: 'alpha',
        contribution: { kind: 'asset', assetType: 'skill' },
        authoredName: 'gone',
        disposition: { kind: 'omitted' },
      },
    ]
    const report = formatCollisionReport(assetGroups(...TWO_WAY), stale)

    expect(report).toContain('no longer contain')
    expect(report).toContain('"gone"')
  })

  test('omits the stale-override section entirely when there are none', () => {
    expect(formatCollisionReport(assetGroups(...TWO_WAY), [])).not.toContain('no longer contain')
  })
})
