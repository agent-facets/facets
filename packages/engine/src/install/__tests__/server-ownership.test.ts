import { describe, expect, test } from 'bun:test'
import type { McpServerFingerprint, PlannedServerConfiguration } from '@agent-facets/protocol'
import { mcpServerKey } from '@agent-facets/protocol'
import {
  buildPreviousMcpOwnership,
  claimsByFacet,
  isDeclarationApproved,
  obsoleteMcpOwnership,
  previouslyOwnedServerNames,
} from '../commit/server-ownership.ts'
import { buildUpdatedReceipt } from '../commit/tri-write.ts'
import {
  CURRENT_RECEIPT_VERSION,
  type LoadedReceipt,
  type ProjectReceiptState,
  RECEIPT_VERSION_0_3,
  type ReceiptConfigurationClaim,
  type ReceiptFacetEntry,
} from '../receipt.ts'

const FP_A = `sha256:${'a'.repeat(64)}` as McpServerFingerprint
const FP_B = `sha256:${'b'.repeat(64)}` as McpServerFingerprint

const STDIO = { type: 'stdio', command: 'npx' } as const

function claim(
  name: string,
  fingerprint: McpServerFingerprint = FP_A,
  materialization: ReceiptConfigurationClaim['materialization'] = { kind: 'authored' },
): ReceiptConfigurationClaim {
  return { kind: 'mcp-server', name, materialization, fingerprint }
}

function facetEntry(configurations: ReceiptConfigurationClaim[]): ReceiptFacetEntry {
  return { version: '1.0.0', integrity: 'sha256:abc', assets: [], configurations }
}

function loaded(facets: Record<string, ReceiptFacetEntry>): ProjectReceiptState {
  return {
    kind: 'loaded',
    record: { authority: 'assets-and-configuration', path: '/tmp/project', facets },
    invalidEntries: [],
  }
}

function assetsOnly(): ProjectReceiptState {
  const record: LoadedReceipt = {
    authority: 'assets-only',
    refinedFrom: RECEIPT_VERSION_0_3,
    path: '/tmp/project',
    facets: { alpha: { version: '1.0.0', assets: [] } },
  }
  return { kind: 'loaded', record, invalidEntries: [] }
}

function configuration(
  effectiveName: string,
  claimants: PlannedServerConfiguration['claimants'],
  fingerprint: McpServerFingerprint = FP_A,
): PlannedServerConfiguration {
  return {
    identity: { kind: 'mcp-server', effectiveName },
    key: mcpServerKey(effectiveName),
    declaration: STDIO,
    fingerprint,
    claimants,
  }
}

describe('buildPreviousMcpOwnership', () => {
  test('keys by effective identity, not authored name', () => {
    const state = loaded({
      alpha: facetEntry([claim('filesystem', FP_A, { kind: 'aliased', as: 'project-fs' })]),
    })

    const index = buildPreviousMcpOwnership(state)

    expect([...index.keys()]).toEqual([mcpServerKey('project-fs')])
    expect(index.get(mcpServerKey('project-fs'))?.effectiveName).toBe('project-fs')
  })

  test('folds duplicate historical claims into one owned identity', () => {
    // Two facets recorded the same effective server. Deleting per claim would
    // issue two removals for one native entry.
    const state = loaded({ beta: facetEntry([claim('fs')]), alpha: facetEntry([claim('fs')]) })

    const index = buildPreviousMcpOwnership(state)

    expect(index.size).toBe(1)
    expect(index.get(mcpServerKey('fs'))?.facets).toEqual(['alpha', 'beta'])
    expect(index.get(mcpServerKey('fs'))?.fingerprints).toEqual([FP_A])
  })

  test('keeps every fingerprint recorded at one identity', () => {
    // Disagreeing historical claims are both evidence of approval. Dropping
    // either would re-prompt for something already accepted here.
    const state = loaded({ alpha: facetEntry([claim('fs', FP_A)]), beta: facetEntry([claim('fs', FP_B)]) })

    const index = buildPreviousMcpOwnership(state)

    expect(index.get(mcpServerKey('fs'))?.fingerprints).toEqual([FP_A, FP_B])
  })

  // The two halves of "a pre-current receipt confers no configuration
  // authority": it cannot delete, and it cannot vouch for consent.
  test('a receipt predating configuration claims owns nothing', () => {
    expect(buildPreviousMcpOwnership(assetsOnly()).size).toBe(0)
  })

  test.each(['missing', 'corrupt', 'path-mismatch'] as const)('an %s receipt owns nothing', (reason) => {
    const state: ProjectReceiptState = { kind: 'unavailable', reason, projectPath: '/tmp/project' }
    expect(buildPreviousMcpOwnership(state).size).toBe(0)
  })
})

describe('obsoleteMcpOwnership', () => {
  test('retains an identity any desired configuration still claims', () => {
    const previous = buildPreviousMcpOwnership(loaded({ alpha: facetEntry([claim('fs'), claim('docs')]) }))

    const obsolete = obsoleteMcpOwnership(previous, [
      configuration('fs', [{ facet: 'beta', authoredName: 'fs', disposition: { kind: 'authored' } }]),
    ])

    // `fs` transferred to another facet rather than becoming stale; only
    // `docs` is unwanted.
    expect(obsolete.map((o) => o.effectiveName)).toEqual(['docs'])
  })

  test('is ordered deterministically', () => {
    const previous = buildPreviousMcpOwnership(
      loaded({ alpha: facetEntry([claim('zulu'), claim('alfa'), claim('mike')]) }),
    )

    expect(obsoleteMcpOwnership(previous, []).map((o) => o.effectiveName)).toEqual(['alfa', 'mike', 'zulu'])
  })
})

describe('previouslyOwnedServerNames', () => {
  test('is exactly what the receipt recorded, sorted', () => {
    const previous = buildPreviousMcpOwnership(loaded({ alpha: facetEntry([claim('zulu'), claim('alfa')]) }))
    expect(previouslyOwnedServerNames(previous)).toEqual(['alfa', 'zulu'])
  })

  test('is empty for a receipt that cannot witness configuration', () => {
    expect(previouslyOwnedServerNames(buildPreviousMcpOwnership(assetsOnly()))).toEqual([])
  })
})

describe('isDeclarationApproved', () => {
  const previous = buildPreviousMcpOwnership(loaded({ alpha: facetEntry([claim('fs', FP_A)]) }))

  test('an identical declaration at the same identity is approved', () => {
    expect(
      isDeclarationApproved(
        previous,
        configuration('fs', [{ facet: 'alpha', authoredName: 'fs', disposition: { kind: 'authored' } }], FP_A),
      ),
    ).toBe(true)
  })

  test('a changed declaration at the same identity is not', () => {
    expect(
      isDeclarationApproved(
        previous,
        configuration('fs', [{ facet: 'alpha', authoredName: 'fs', disposition: { kind: 'authored' } }], FP_B),
      ),
    ).toBe(false)
  })

  test('the same declaration at a new identity is not', () => {
    expect(
      isDeclarationApproved(
        previous,
        configuration('other', [{ facet: 'alpha', authoredName: 'fs', disposition: { kind: 'authored' } }], FP_A),
      ),
    ).toBe(false)
  })

  test('a receipt predating configuration claims approves nothing', () => {
    expect(
      isDeclarationApproved(
        buildPreviousMcpOwnership(assetsOnly()),
        configuration('fs', [{ facet: 'alpha', authoredName: 'fs', disposition: { kind: 'authored' } }], FP_A),
      ),
    ).toBe(false)
  })

  // Approval is machine-local. A teammate committing `facets.json` and
  // `facets.lock` publishes what the project WANTS; it cannot publish that
  // their machine agreed to run it. Every state that is not this machine's
  // own readable receipt therefore approves nothing.
  test.each([
    ['a teammate has a receipt this machine does not', { kind: 'unavailable', reason: 'missing' } as const],
    ['the receipt belongs to another project', { kind: 'unavailable', reason: 'path-mismatch' } as const],
  ])('%s, so nothing is approved here', (_label, unavailable) => {
    const state: ProjectReceiptState = { ...unavailable, projectPath: '/tmp/project' }
    const desired = configuration('fs', [{ facet: 'alpha', authoredName: 'fs', disposition: { kind: 'authored' } }])

    expect(isDeclarationApproved(buildPreviousMcpOwnership(state), desired)).toBe(false)
  })
})

describe('claimsByFacet', () => {
  test('records one claim per claimant, under its own authored name', () => {
    // One effective configuration, two facets. Both must be recorded, or
    // removing one would take the other's configuration with it.
    const claims = claimsByFacet([
      configuration('fs', [
        { facet: 'alpha', authoredName: 'filesystem', disposition: { kind: 'aliased', as: 'fs' } },
        { facet: 'beta', authoredName: 'fs', disposition: { kind: 'authored' } },
      ]),
    ])

    expect(claims.alpha).toEqual([claim('filesystem', FP_A, { kind: 'aliased', as: 'fs' })])
    expect(claims.beta).toEqual([claim('fs', FP_A)])
  })

  test('a facet named __proto__ becomes an own key', () => {
    const claims = claimsByFacet([
      configuration('fs', [{ facet: '__proto__', authoredName: 'fs', disposition: { kind: 'authored' } }]),
    ])

    expect(Object.hasOwn(claims, '__proto__')).toBe(true)
    expect(Object.keys(claims)).toEqual(['__proto__'])
  })

  test('round-trips through the receipt and back into ownership', () => {
    const configurations = [
      configuration('fs', [
        { facet: 'alpha', authoredName: 'filesystem', disposition: { kind: 'aliased', as: 'fs' } },
        { facet: 'beta', authoredName: 'fs', disposition: { kind: 'authored' } },
      ]),
    ]

    const receipt = buildUpdatedReceipt('/tmp/project', {
      kind: 'written',
      facetEntries: {
        alpha: { source: { kind: 'local', path: './a' }, version: '1.0.0', integrity: 'sha256:a', assets: [] },
        beta: { source: { kind: 'local', path: './b' }, version: '1.0.0', integrity: 'sha256:b', assets: [] },
      },
      configurations: claimsByFacet(configurations),
    })

    expect(receipt.version).toBe(CURRENT_RECEIPT_VERSION)
    // Two per-facet claims fold back into ONE owned identity with both
    // claimants — the property that makes removing one facet safe.
    const index = buildPreviousMcpOwnership(loaded(receipt.facets))
    expect(index.size).toBe(1)
    expect(index.get(mcpServerKey('fs'))?.facets).toEqual(['alpha', 'beta'])
    // And it authorizes deleting nothing while the configuration is desired.
    expect(obsoleteMcpOwnership(index, configurations)).toEqual([])
  })

  test('records nothing when nothing was reconciled', () => {
    expect(claimsByFacet([])).toEqual({})
  })
})
