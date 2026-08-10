import type {
  McpServerCapabilityFailure,
  McpServerContribution,
  McpServerPreparationOutcome,
} from '@agent-facets/adapter'

/**
 * The behavioral fixture matrix every MCP-capable adapter must satisfy.
 *
 * The cases here are stated in portable terms only — desired declarations,
 * prior ownership, and the outcomes those imply. What a document *looks like*
 * is the one thing that cannot be shared between a JSON, a JSONC, and a TOML
 * adapter, so each adapter supplies its own native seed per case and the
 * expectations stay here.
 *
 * `satisfies Record<McpMatrixCaseId, ...>` on an adapter's seed table is what
 * makes this work: adding a case here fails to compile in all three adapters
 * until each one says what its document looks like. Coverage cannot silently
 * drift apart, and the expectations cannot be quietly reworded per adapter.
 */

/** The stdio server used wherever a case needs one. */
export const STDIO_SERVER: McpServerContribution = {
  name: 'fs',
  declaration: { type: 'stdio', command: 'srv', args: ['--root', '/w'], env: { TOKEN_NAME: 'A' } },
}

/** The same server with both optional collections omitted. */
export const STDIO_SERVER_MINIMAL: McpServerContribution = {
  name: 'fs',
  declaration: { type: 'stdio', command: 'srv' },
}

/** The Streamable HTTP server used wherever a case needs one. */
export const HTTP_SERVER: McpServerContribution = {
  name: 'api',
  declaration: { type: 'http', url: 'https://mcp.example.com/mcp' },
}

/** A server carrying a native member outside the portable model. */
export const EXTENDED_SERVER: McpServerContribution = {
  name: 'ext',
  declaration: { type: 'stdio', command: 'ext-server', args: ['--new'] },
}

/** The name a seed uses for an entry that is neither desired nor owned. */
export const UNOWNED_NAME = 'manual'

/** The name a seed uses for an entry the project owns but no longer wants. */
export const OBSOLETE_NAME = 'legacy'

export type McpMatrixExpectation =
  | {
      readonly kind: 'prepared'
      readonly outcomes: readonly McpServerPreparationOutcome[]
      readonly apply: 'unchanged' | 'changed'
    }
  | { readonly kind: 'prepare-failed'; readonly code: McpServerCapabilityFailure['code'] }

export interface McpMatrixCase {
  readonly id: string
  /** What the case is proving, used as the test name. */
  readonly describes: string
  readonly desired: readonly McpServerContribution[]
  readonly previouslyOwnedNames: readonly string[]
  readonly expect: McpMatrixExpectation
}

/**
 * Every case, in a fixed order.
 *
 * Read the `describes` text as the requirement; the outcome list is the proof.
 */
export const MCP_MATRIX_CASES = [
  {
    id: 'document-absent',
    describes: 'plans an addition against a document that does not exist yet, without creating it',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: [],
    expect: { kind: 'prepared', outcomes: [{ kind: 'absent', name: 'fs', ownership: 'untracked' }], apply: 'changed' },
  },
  {
    id: 'absent-untracked',
    describes: 'adds a desired server the document does not define',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: [],
    expect: { kind: 'prepared', outcomes: [{ kind: 'absent', name: 'fs', ownership: 'untracked' }], apply: 'changed' },
  },
  {
    id: 'absent-tracked',
    describes: 'recreates an owned entry that was deleted out of band',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: ['fs'],
    expect: { kind: 'prepared', outcomes: [{ kind: 'absent', name: 'fs', ownership: 'tracked' }], apply: 'changed' },
  },
  {
    id: 'equivalent-tracked',
    describes: 'adopts an owned entry that already says what is wanted, without writing',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: ['fs'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'equivalent', name: 'fs', ownership: 'tracked' }],
      apply: 'unchanged',
    },
  },
  {
    id: 'equivalent-untracked',
    describes: 'reports an equal entry the project does not own as untracked, so consent can be asked for',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: [],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'equivalent', name: 'fs', ownership: 'untracked' }],
      apply: 'unchanged',
    },
  },
  {
    id: 'equivalent-normalized',
    describes: 'treats an omitted optional collection and an empty one as the same thing',
    desired: [STDIO_SERVER_MINIMAL],
    previouslyOwnedNames: ['fs'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'equivalent', name: 'fs', ownership: 'tracked' }],
      apply: 'unchanged',
    },
  },
  {
    id: 'equivalent-formatting-only',
    describes: 'ignores member order and formatting when proving equality',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: ['fs'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'equivalent', name: 'fs', ownership: 'tracked' }],
      apply: 'unchanged',
    },
  },
  {
    id: 'divergent-tracked',
    describes: 'repairs an owned entry whose behavior drifted',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: ['fs'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'divergent', name: 'fs', ownership: 'tracked' }],
      apply: 'changed',
    },
  },
  {
    // Argument ORDER, nothing else. An adapter comparing args as a set — or
    // sorting them before comparing — passes every other divergent case while
    // silently keeping a server that runs with different arguments.
    id: 'divergent-argument-order',
    describes: 'treats a reordered argument list as a behavioral difference',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: ['fs'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'divergent', name: 'fs', ownership: 'tracked' }],
      apply: 'changed',
    },
  },
  {
    // One environment VALUE. An adapter that compares only env key sets, or
    // skips env entirely, would call this equivalent and leave the server
    // pointed at the wrong thing.
    id: 'divergent-environment-value',
    describes: 'treats a changed environment value as a behavioral difference',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: ['fs'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'divergent', name: 'fs', ownership: 'tracked' }],
      apply: 'changed',
    },
  },
  {
    id: 'divergent-untracked',
    describes: 'reports a differing entry the project does not own as an untracked takeover',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: [],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'divergent', name: 'fs', ownership: 'untracked' }],
      apply: 'changed',
    },
  },
  {
    id: 'divergent-unprovable',
    describes: 'fails safe when an entry carries a member whose effect on launch or connection is unknown',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: ['fs'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'divergent', name: 'fs', ownership: 'tracked' }],
      apply: 'changed',
    },
  },
  {
    id: 'safe-extension-preserved',
    describes: 'keeps a behavior-neutral native member when rewriting an owned entry',
    desired: [EXTENDED_SERVER],
    previouslyOwnedNames: ['ext'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'divergent', name: 'ext', ownership: 'tracked' }],
      apply: 'changed',
    },
  },
  {
    id: 'http-absent',
    describes: 'renders a Streamable HTTP declaration natively',
    desired: [HTTP_SERVER],
    previouslyOwnedNames: [],
    expect: { kind: 'prepared', outcomes: [{ kind: 'absent', name: 'api', ownership: 'untracked' }], apply: 'changed' },
  },
  {
    id: 'http-equivalent',
    describes: 'proves an existing Streamable HTTP entry equal to the desired URL',
    desired: [HTTP_SERVER],
    previouslyOwnedNames: ['api'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'equivalent', name: 'api', ownership: 'tracked' }],
      apply: 'unchanged',
    },
  },
  {
    id: 'obsolete-owned-present',
    describes: 'removes an owned entry the desired set no longer names',
    desired: [],
    previouslyOwnedNames: [OBSOLETE_NAME],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'obsolete-owned', name: OBSOLETE_NAME, occupancy: 'present' }],
      apply: 'changed',
    },
  },
  {
    id: 'obsolete-owned-absent',
    describes: 'reports an owned entry that is already gone so the claim can be dropped, and writes nothing',
    desired: [],
    previouslyOwnedNames: [OBSOLETE_NAME],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'obsolete-owned', name: OBSOLETE_NAME, occupancy: 'absent' }],
      apply: 'unchanged',
    },
  },
  {
    id: 'unowned-entry-untouched',
    describes: 'says nothing about, and does not touch, an entry that is neither desired nor owned',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: ['fs'],
    expect: {
      kind: 'prepared',
      outcomes: [{ kind: 'equivalent', name: 'fs', ownership: 'tracked' }],
      apply: 'unchanged',
    },
  },
  {
    id: 'complete-batch',
    describes: 'reports every occupancy in one preparation and commits them in a single write',
    desired: [STDIO_SERVER, HTTP_SERVER],
    previouslyOwnedNames: ['fs', OBSOLETE_NAME],
    expect: {
      kind: 'prepared',
      outcomes: [
        { kind: 'equivalent', name: 'fs', ownership: 'tracked' },
        { kind: 'divergent', name: 'api', ownership: 'untracked' },
        { kind: 'obsolete-owned', name: OBSOLETE_NAME, occupancy: 'present' },
      ],
      apply: 'changed',
    },
  },
  {
    id: 'unrelated-settings-preserved',
    describes: 'leaves settings that have nothing to do with MCP alone',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: [],
    expect: { kind: 'prepared', outcomes: [{ kind: 'absent', name: 'fs', ownership: 'untracked' }], apply: 'changed' },
  },
  {
    id: 'nothing-desired-nothing-owned',
    describes: 'still discloses the document it inspected when there is nothing to do',
    desired: [],
    previouslyOwnedNames: [],
    expect: { kind: 'prepared', outcomes: [], apply: 'unchanged' },
  },
  {
    id: 'malformed-document',
    describes: 'reports a document it cannot parse and leaves it byte-for-byte alone',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: [],
    expect: { kind: 'prepare-failed', code: 'parse-failed' },
  },
  {
    id: 'invalid-server-map',
    describes: 'refuses a server map whose shape it cannot safely edit',
    desired: [STDIO_SERVER],
    previouslyOwnedNames: [],
    expect: { kind: 'prepare-failed', code: 'validation-failed' },
  },
] as const satisfies readonly McpMatrixCase[]

/** The identifier of every case in {@link MCP_MATRIX_CASES}. */
export type McpMatrixCaseId = (typeof MCP_MATRIX_CASES)[number]['id']
