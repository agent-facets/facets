import { describe, expect, test } from 'bun:test'
import type { MaterializationCollisionGroup, StaleMaterializationOverride } from '@agent-facets/engine'
import type {
  CollisionGroup,
  McpServerDeclaration,
  McpServerFingerprint,
  ServerCollisionGroup,
} from '@agent-facets/protocol'
import { computeMcpServerFingerprint } from '@agent-facets/protocol'
import {
  collisionClaimants,
  describeClaimantDeclaration,
  formatCollisionReport,
  manifestLocation,
  PLACEHOLDER_ALIAS,
  serverManifestLocation,
} from '../collision-report.ts'

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

// ---------------------------------------------------------------------------
// MCP server claimants
// ---------------------------------------------------------------------------

function declaration(command: string): McpServerDeclaration {
  return { type: 'stdio', command } as McpServerDeclaration
}

function serverMember(facet: string, command: string, effectiveName = 'filesystem') {
  const decl = declaration(command)
  return {
    facet,
    authoredName: 'filesystem',
    effectiveName,
    declaration: decl,
    fingerprint: computeMcpServerFingerprint(decl) as McpServerFingerprint,
    disposition: { kind: 'authored' } as const,
  }
}

const SERVER_GROUP: ServerCollisionGroup = {
  effectiveName: 'filesystem',
  members: [serverMember('alpha', 'alpha-cmd'), serverMember('beta', 'beta-cmd')],
}

function serverGroups(...groups: ServerCollisionGroup[]): MaterializationCollisionGroup[] {
  return groups.map((group) => ({ kind: 'mcp-server', group }))
}

describe('formatCollisionReport — MCP server claimants', () => {
  const report = formatCollisionReport(serverGroups(SERVER_GROUP), [])

  test('names the group as MCP servers and lists every claimant', () => {
    expect(report).toContain('MCP servers — "filesystem" is claimed by:')
    expect(report).toContain('alpha: server filesystem → "filesystem"')
    expect(report).toContain('beta: server filesystem → "filesystem"')
  })

  test('summarizes each declaration without reproducing it', () => {
    expect(report).toContain('stdio, command "alpha-cmd"')
    expect(report).toContain('stdio, command "beta-cmd"')
  })

  test('the fingerprint prefix tells two claimants apart', () => {
    const [first, second] = SERVER_GROUP.members
    if (first === undefined || second === undefined) expect.unreachable()
    for (const member of [first, second]) {
      expect(report).toContain(member.fingerprint.slice('sha256:'.length, 'sha256:'.length + 8))
    }
  })

  test('points at the exact materialization.servers location', () => {
    expect(report).toContain(serverManifestLocation('alpha', 'filesystem'))
    expect(report).toContain('facets["alpha"].materialization.servers["filesystem"]')
  })

  test('offers a valid alias and omission snippet for every claimant', () => {
    const snippets = report.split('\n').filter((line) => line.includes('alias:') || line.includes('omit:'))
    expect(snippets).toHaveLength(4)
    for (const line of snippets) {
      const body = line.slice(line.indexOf('"'))
      expect(() => JSON.parse(`{${body}}`)).not.toThrow()
    }
  })

  test('the shape example uses the servers group', () => {
    expect(report).toContain('"servers": {')
  })

  test('prefers no claimant', () => {
    // Each claimant gets the identical pair of snippets, so nothing in the
    // report reads as a recommendation about which facet should yield.
    const alpha = report.split('alpha:')[1]?.split('beta:')[0] ?? ''
    const beta = report.split('beta:')[1] ?? ''
    expect(alpha).toContain(PLACEHOLDER_ALIAS)
    expect(beta).toContain(PLACEHOLDER_ALIAS)
    expect(report).not.toContain('alpha-filesystem')
  })

  test('states that native configuration was not changed either', () => {
    expect(report).toContain('MCP configuration were NOT changed')
  })
})

describe('formatCollisionReport — mixed asset and server groups', () => {
  const report = formatCollisionReport([...assetGroups(...TWO_WAY), ...serverGroups(SERVER_GROUP)], [])

  test('reports both domains in one failure', () => {
    expect(report).toContain('project skills and commands — "review" is claimed by:')
    expect(report).toContain('MCP servers — "filesystem" is claimed by:')
  })

  test('every claimant from both domains gets a location', () => {
    expect(report).toContain(manifestLocation('alpha', 'skill', 'review'))
    expect(report).toContain(serverManifestLocation('alpha', 'filesystem'))
  })

  test('asset claimants carry their scope', () => {
    expect(report).toContain('project skill review')
  })
})

describe('formatCollisionReport — names that collide with Object.prototype', () => {
  test('a server named __proto__ is quoted, not interpreted', () => {
    const group: ServerCollisionGroup = {
      effectiveName: '__proto__',
      members: SERVER_GROUP.members.map((member) => ({
        ...member,
        authoredName: '__proto__',
        effectiveName: '__proto__',
      })),
    }
    const report = formatCollisionReport(serverGroups(group), [])

    expect(report).toContain('facets["alpha"].materialization.servers["__proto__"]')
    expect(Object.keys(Object.prototype)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Claimant identity and declaration summaries
// ---------------------------------------------------------------------------

describe('collisionClaimants — alias annotation follows the exact member', () => {
  test('two MCP claimants sharing an authored name keep their own dispositions', () => {
    // The defect this covers: looking a claimant back up by authored name
    // alone picks the first match, so the annotation lands on whichever member
    // happens to come first rather than on the one that was aliased.
    const aliased = {
      ...serverMember('alpha', 'alpha-cmd'),
      disposition: { kind: 'aliased', as: 'filesystem' } as const,
    }
    const authored = serverMember('beta', 'beta-cmd')
    const group: ServerCollisionGroup = { effectiveName: 'filesystem', members: [authored, aliased] }

    const claimants = collisionClaimants(serverGroups(group)[0] as MaterializationCollisionGroup)

    expect(claimants.map((claimant) => [claimant.facet, claimant.aliasedFrom])).toEqual([
      ['beta', false],
      ['alpha', 'filesystem'],
    ])
  })

  test('reversing member order does not move the annotation', () => {
    const aliased = {
      ...serverMember('alpha', 'alpha-cmd'),
      disposition: { kind: 'aliased', as: 'filesystem' } as const,
    }
    const authored = serverMember('beta', 'beta-cmd')
    const forward: ServerCollisionGroup = { effectiveName: 'filesystem', members: [aliased, authored] }
    const reversed: ServerCollisionGroup = { effectiveName: 'filesystem', members: [authored, aliased] }

    const annotationFor = (group: ServerCollisionGroup, facet: string): false | string =>
      collisionClaimants(serverGroups(group)[0] as MaterializationCollisionGroup).find(
        (claimant) => claimant.facet === facet,
      )?.aliasedFrom ?? false

    expect(annotationFor(forward, 'alpha')).toBe('filesystem')
    expect(annotationFor(reversed, 'alpha')).toBe('filesystem')
    expect(annotationFor(forward, 'beta')).toBe(false)
    expect(annotationFor(reversed, 'beta')).toBe(false)
  })

  test('two asset claimants sharing an authored name keep their own dispositions', () => {
    const group: CollisionGroup = {
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
          // A no-op alias is legal, and shares the authored name with the row
          // above it.
          disposition: { kind: 'aliased', as: 'review' },
        },
      ],
    }

    const claimants = collisionClaimants(assetGroups(group)[0] as MaterializationCollisionGroup)

    expect(claimants.map((claimant) => [claimant.facet, claimant.aliasedFrom])).toEqual([
      ['alpha', false],
      ['beta', 'review'],
    ])
    const report = formatCollisionReport(assetGroups(group), [])
    expect(report).toContain('beta: project command review → "review" (already aliased from "review")')
    expect(report).toContain('alpha: project skill review → "review"\n')
  })
})

describe('describeClaimantDeclaration — HTTP origins', () => {
  const summarize = (url: string): string => {
    const decl = { type: 'http', url } as McpServerDeclaration
    return describeClaimantDeclaration(decl, computeMcpServerFingerprint(decl) as McpServerFingerprint)
  }

  test('the path never reaches the summary', () => {
    expect(summarize('https://example.com/mcp/secret-token')).toContain('https://example.com')
    expect(summarize('https://example.com/mcp/secret-token')).not.toContain('secret-token')
  })

  test('a backslash is a path separator, not part of the host', () => {
    // Accepted by WHATWG parsing and by the schema; the old regex read the
    // backslash as an ordinary host character and echoed the whole value.
    expect(summarize('https://example.com\\secret-token')).not.toContain('secret-token')
  })

  test('surrounding whitespace is stripped rather than defeating the parse', () => {
    expect(summarize('  https://example.com/mcp  ')).toContain('https://example.com')
    expect(summarize('  https://example.com/mcp  ')).not.toContain('/mcp')
  })

  test('scheme and host case are normalized', () => {
    expect(summarize('HTTPS://Example.COM/mcp')).toContain('https://example.com')
  })

  test('an explicit non-default port is kept', () => {
    expect(summarize('http://example.com:8080/mcp')).toContain('http://example.com:8080')
  })

  test('a default port is elided', () => {
    expect(summarize('https://example.com:443/mcp')).toContain('https://example.com')
    expect(summarize('https://example.com:443/mcp')).not.toContain(':443')
  })

  test('an unparseable value becomes a sentinel rather than an echo', () => {
    // Defensive: the schema rejects this, so reaching it means something
    // upstream changed. It must still not print the value.
    expect(summarize('not a url at all')).not.toContain('not a url at all')
    expect(summarize('not a url at all')).toContain('<unparseable url>')
  })
})
