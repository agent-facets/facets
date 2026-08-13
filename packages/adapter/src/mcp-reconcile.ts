import type { McpServerContribution, McpServerPreparationOutcome, ReadonlyMcpServerDeclaration } from './mcp-servers.ts'

/**
 * The format-independent half of MCP preparation.
 *
 * Every adapter answers the same three questions — which desired entries are
 * missing, which already say what we want, and which owned entries are now
 * obsolete — and the answers depend only on set membership plus one semantic
 * comparison per present entry. Only that comparison is format-specific.
 *
 * Keeping the bookkeeping here means the ownership rule ("desired state
 * authorizes reconciliation; receipt ownership alone authorizes deletion") is
 * implemented once. An adapter cannot accidentally delete an entry it was
 * never told it owned, because it is not the code deciding.
 */

/** The result of an adapter's native comparison at a name the document defines. */
export type McpNativeMatch = 'equivalent' | 'divergent'

export interface ReconcileMcpServersInput {
  /** The complete desired set, in the order outcomes should be reported. */
  readonly desired: readonly McpServerContribution[]
  /** Effective names a prior successful operation recorded for this adapter. */
  readonly previouslyOwnedNames: readonly string[]
  /** Every effective server name the native document currently defines. */
  readonly presentNames: ReadonlySet<string>
  /**
   * Compare one desired declaration against the entry the document already has
   * under that name. Called only for names `presentNames` contains, at most
   * once each — presence is decided here, not by the comparison, so the two
   * cannot disagree.
   *
   * An adapter that cannot *prove* equality returns `divergent`: unprovable
   * equality fails safe.
   */
  readonly compare: (contribution: McpServerContribution) => McpNativeMatch
}

/**
 * Classify the complete desired set plus every obsolete owned name.
 *
 * Outcomes are returned in a deterministic order — desired entries in the
 * order supplied, then obsolete owned names in the order supplied — so a
 * caller rendering them produces stable output without sorting.
 *
 * A name that is neither desired nor owned produces no outcome at all. That
 * silence is the contract: it is someone else's entry, and the adapter has
 * nothing to say about it.
 */
export function reconcileMcpServers(input: ReconcileMcpServersInput): readonly McpServerPreparationOutcome[] {
  const owned = new Set(input.previouslyOwnedNames)
  const desiredNames = new Set(input.desired.map((contribution) => contribution.name))
  const outcomes: McpServerPreparationOutcome[] = []

  for (const contribution of input.desired) {
    const ownership = owned.has(contribution.name) ? 'tracked' : 'untracked'

    if (!input.presentNames.has(contribution.name)) {
      outcomes.push({ kind: 'absent', name: contribution.name, ownership })
      continue
    }

    outcomes.push({ kind: input.compare(contribution), name: contribution.name, ownership })
  }

  for (const name of input.previouslyOwnedNames) {
    if (desiredNames.has(name)) continue
    outcomes.push({
      kind: 'obsolete-owned',
      name,
      occupancy: input.presentNames.has(name) ? 'present' : 'absent',
    })
  }

  return outcomes
}

/**
 * Every string a native rendering of this declaration must reproduce verbatim.
 *
 * Portable declarations are literal: nothing in them is expanded, interpolated,
 * or normalized. Several target tools *do* interpolate their own configuration
 * values, so an adapter has to check whether writing these literals would hand
 * its tool something to substitute. This is the list to check — collected here
 * so "which values are literal" is answered once, and an adapter that later
 * gains a field cannot forget to scan it.
 *
 * Server names are excluded: they are constrained to a portable grammar that
 * contains no interpolation syntax in any supported format.
 */
export function mcpDeclarationLiterals(declaration: ReadonlyMcpServerDeclaration): readonly string[] {
  if (declaration.type === 'http') return [declaration.url]
  return [declaration.command, ...(declaration.args ?? []), ...Object.values(declaration.env ?? {})]
}

/**
 * Whether applying these outcomes would change the document.
 *
 * Derived from the outcomes rather than tracked alongside them, so "we
 * reported everything equivalent" and "we are about to write" cannot drift
 * apart. `equivalent` is adopted without a write and an `obsolete-owned` entry
 * that is already gone needs no write to stay gone.
 */
export function mcpOutcomesRequireWrite(outcomes: readonly McpServerPreparationOutcome[]): boolean {
  return outcomes.some(outcomeRequiresWrite)
}

function outcomeRequiresWrite(outcome: McpServerPreparationOutcome): boolean {
  switch (outcome.kind) {
    case 'absent':
    case 'divergent':
      return true
    case 'equivalent':
      return false
    case 'obsolete-owned':
      return outcome.occupancy === 'present'
  }
}
