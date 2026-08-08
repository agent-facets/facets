import type { ContributionKind } from '@agent-facets/engine'

/**
 * How a contribution kind is named in user-facing output, and how it is keyed
 * in a React list.
 *
 * One place, because a materialization override shows up in five different
 * surfaces — the pruned-intent notice, the frozen drift list, the collision
 * workspace, the non-interactive collision report, and verbose logging — and
 * a server that reads as "servers" in one and "mcp-server" in another looks
 * like two different things to the person trying to fix it.
 */

/** The noun a user sees. Asset types are already the words users know. */
export function describeContribution(contribution: ContributionKind): string {
  return contribution.kind === 'asset' ? contribution.assetType : 'MCP server'
}

/** A stable key fragment, distinct across kinds. */
export function contributionKey(contribution: ContributionKind): string {
  return contribution.kind === 'asset' ? `asset:${contribution.assetType}` : 'mcp-server'
}
