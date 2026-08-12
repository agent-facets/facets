import { describe, expect, test } from 'bun:test'
import type { McpServerCapabilityFailure } from '@agent-facets/adapter'
import type { McpConsentRequest, McpUnsupportedAdapter } from '@agent-facets/engine'
import {
  describeMcpCapabilityFailure,
  describeMcpCapabilityHint,
  formatMcpConsentReport,
  formatUnsupportedMcpAdaptersReport,
} from '../mcp-report.ts'

const REQUEST: McpConsentRequest = {
  declarations: [
    {
      identity: { kind: 'mcp-server', effectiveName: 'filesystem' },
      fingerprint: `sha256:${'a'.repeat(64)}`,
      declaration: { type: 'stdio', command: 'npx', args: ['-y', 'srv'], env: { TOKEN_NAME: 'A' } },
      claimants: [
        { facet: 'alpha', authoredName: 'filesystem', disposition: { kind: 'authored' } },
        { facet: 'beta', authoredName: 'fs', disposition: { kind: 'aliased', as: 'filesystem' } },
      ],
      standing: { kind: 'unknown-identity' },
    },
  ],
  takeovers: [
    {
      adapter: 'claude-code',
      identity: { kind: 'mcp-server', effectiveName: 'docs' },
      existing: 'divergent',
      declaration: { type: 'http', url: 'https://mcp.example.com/mcp' },
    },
  ],
}

describe('formatMcpConsentReport', () => {
  const report = formatMcpConsentReport(REQUEST, 'accept-mcp')

  // The whole reason this report exists: the Ink block goes to stdout, which
  // in CI is the discarded stream, so a caller deciding whether to pass the
  // flag would otherwise be approving something they were never shown.
  test('discloses each declaration in full', () => {
    expect(report).toContain('stdio "npx" "-y" "srv"')
    expect(report).toContain('env "TOKEN_NAME"="A"')
    expect(report).toContain('http "https://mcp.example.com/mcp"')
  })

  test('names every claimant of a shared identity', () => {
    expect(report).toContain('from alpha, beta')
  })

  // An effective identity claimed by two facets is omitted by editing BOTH,
  // and each edit is keyed by that facet's own authored name — `beta` reaches
  // `filesystem` through an alias from `fs`.
  test('gives one editable omission location per claimant', () => {
    expect(report).toContain('facets["alpha"].materialization.servers["filesystem"]')
    expect(report).toContain('"filesystem": { "kind": "omitted" }')
    expect(report).toContain('facets["beta"].materialization.servers["fs"]')
    expect(report).toContain('"fs": { "kind": "omitted" }')
  })

  test('names the takeover section separately from the declarations', () => {
    expect(report).toContain('Existing entries this would take over:')
    expect(report).toContain('claude-code: docs differs and would be replaced')
  })

  test('names the flag from the shared definition', () => {
    expect(report).toContain('Re-run with --accept-mcp')
  })

  test('states that nothing was changed', () => {
    expect(report).toContain('MCP configuration were NOT changed.')
  })
})

describe('describeMcpCapabilityFailure', () => {
  test('an interpolated literal names the server and shows the exact value', () => {
    // The value is what makes this actionable: a user told only that "a value"
    // would be expanded has to guess which of a command, four arguments, and
    // six environment entries is the offender.
    const described = describeMcpCapabilityFailure({
      code: 'conflict',
      reason: 'interpolation',
      serverName: 'fs',
      value: '{env:TOKEN}',
    })

    expect(described).toContain('"fs"')
    expect(described).toContain('"{env:TOKEN}"')
  })

  test('an interpolated literal names no document', () => {
    const described = describeMcpCapabilityFailure({
      code: 'conflict',
      reason: 'interpolation',
      serverName: 'fs',
      value: '{env:TOKEN}',
    })

    expect(described).not.toContain('opencode')
    expect(described).not.toContain('/')
  })

  test('a value cannot add a line or reach the terminal', () => {
    const hostile = '\u001b[2K\nsudo rm -rf /'
    const described = describeMcpCapabilityFailure({
      code: 'conflict',
      reason: 'interpolation',
      serverName: 'fs',
      value: hostile,
    })

    expect(described).not.toContain('\u001b')
    expect(described.split('\n')).toHaveLength(1)
    // Escaped, not elided: the complete value is still there to read.
    expect(described).toContain('\\u001b[2K\\nsudo rm -rf /')
  })

  test('a drifted document is described by its path alone', () => {
    const described = describeMcpCapabilityFailure({
      code: 'conflict',
      reason: 'document-changed',
      path: '/p/opencode.jsonc',
    })

    expect(described).toBe('/p/opencode.jsonc changed after it was inspected; nothing was written')
  })

  test('a native-state conflict carries the format-specific detail', () => {
    const described = describeMcpCapabilityFailure({
      code: 'conflict',
      reason: 'native-state',
      path: '/p/config.toml',
      detail: 'cannot patch an inline table',
    })

    expect(described).toContain('/p/config.toml')
    expect(described).toContain('cannot patch an inline table')
  })
})

describe('describeMcpCapabilityHint', () => {
  test('the reasons whose consequence is not obvious explain themselves', () => {
    const interpolation: McpServerCapabilityFailure = {
      code: 'conflict',
      reason: 'interpolation',
      serverName: 'fs',
      value: '{env:T}',
    }
    const drift: McpServerCapabilityFailure = { code: 'conflict', reason: 'document-changed', path: '/p/a.json' }

    expect(describeMcpCapabilityHint(interpolation)).toContain('substitute')
    expect(describeMcpCapabilityHint(drift)).toContain('another process')
  })

  test('a failure that already explains itself gets no second sentence', () => {
    expect(describeMcpCapabilityHint({ code: 'parse-failed', path: '/p/a.json', message: 'bad' })).toBeUndefined()
    expect(
      describeMcpCapabilityHint({ code: 'conflict', reason: 'native-state', path: '/p/a.toml', detail: 'nope' }),
    ).toBeUndefined()
  })
})

describe('formatUnsupportedMcpAdaptersReport', () => {
  const adapters: McpUnsupportedAdapter[] = [
    { kind: 'asset-only-api', adapter: 'legacy-tool', apiVersion: '0.1' },
    { kind: 'capability-declined', adapter: 'plain-tool' },
  ]
  const report = formatUnsupportedMcpAdaptersReport(adapters, ['docs', 'filesystem'])

  test('names every unsupported adapter', () => {
    expect(report).toContain('legacy-tool')
    expect(report).toContain('plain-tool')
  })

  // "Upgrade it" is wrong advice for an adapter that answered the question
  // and said no, so the two remedies must not be collapsed into one line.
  test('gives the remedy that actually applies to each adapter', () => {
    expect(report).toContain('upgrade it:')
    expect(report).toContain('omit the server declarations in facets.json, or deselect this adapter')
  })

  test('names the servers that forced the requirement', () => {
    expect(report).toContain('docs, filesystem')
  })

  test('states that nothing was changed', () => {
    expect(report).toContain('MCP configuration were NOT changed.')
  })

  // A declaration is not needed to act on this failure, and this report can
  // reach a CI log, so it must not carry one.
  test('discloses no declaration', () => {
    expect(report).not.toContain('npx')
    expect(report).not.toContain('https://')
  })
})
