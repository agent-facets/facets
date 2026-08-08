import type { AssetType, Scope } from '@agent-facets/common'
import type {
  MaterializationCollisionGroup,
  RunInstallFailure,
  StaleMaterializationOverride,
} from '@agent-facets/engine'
import type { MaterializationNamespace, McpServerDeclaration } from '@agent-facets/protocol'
import { overrideGroupKey, SERVER_OVERRIDE_GROUP } from '@agent-facets/protocol'
import { describeContribution } from './contribution.ts'

/**
 * The complete, copy-pasteable account of a materialization collision.
 *
 * This exists because the rich Ink block is written to stdout, and the
 * situations that produce a collision without a resolver are exactly the
 * situations where stdout is a log file nobody reads: CI, a piped
 * command, `--frozen-lockfile`. Leaving `code=MATERIALIZATION_COLLISION`
 * on stderr as the only machine-visible signal tells an engineer that
 * something named a constant went wrong, and nothing about which two
 * facets to reconcile.
 *
 * Three rules govern the wording, all of them from the spec and all of
 * them easy to violate by accident:
 *
 *   - **No winner.** Every claimant is described identically. The tool
 *     has no basis for preferring one publisher over another, and a
 *     hint that looked like a recommendation would become one.
 *   - **No invented alias.** The examples use a fixed placeholder, not a
 *     name derived from the facet. `alpha-review` would look like the
 *     answer rather than a slot.
 *   - **State the absence of damage.** After a wall of error text, the
 *     first thing a reader wants to know is whether their project is now
 *     half-installed.
 */

/**
 * The alias used in examples. Grammar-valid on purpose — the spec
 * requires the snippets to be syntactically valid, so a metasyntactic
 * `<name>` would not do — and obviously a placeholder, so it cannot be
 * mistaken for advice.
 */
export const PLACEHOLDER_ALIAS = 'choose-a-name'

/**
 * Where in `facets.json` a choice for this asset is written.
 *
 * Derived through the published `overrideGroupKey` rather than a local
 * type-to-group switch, so a rename in the schema cannot leave this
 * error pointing at a path that no longer exists.
 */
export function manifestLocation(facet: string, type: AssetType, authoredName: string): string {
  return `facets[${JSON.stringify(facet)}].materialization.${overrideGroupKey(type)}[${JSON.stringify(authoredName)}]`
}

/** Human phrasing for the namespace two assets are contesting. */
export function describeNamespace(namespace: MaterializationNamespace, scope: Scope): string {
  switch (namespace) {
    case 'skill-command':
      // Worth spelling out: a skill colliding with a command surprises
      // people who assume the two are separate.
      return `${scope} skills and commands`
    case 'agent':
      return `${scope} agents`
  }
}

/** Where in `facets.json` a choice for this server is written. */
export function serverManifestLocation(facet: string, authoredName: string): string {
  return `facets[${JSON.stringify(facet)}].materialization.${SERVER_OVERRIDE_GROUP}[${JSON.stringify(authoredName)}]`
}

/** A stable React/list key for one collision group. */
export function collisionGroupKey(entry: MaterializationCollisionGroup): string {
  return entry.kind === 'asset'
    ? `asset:${entry.group.scope}:${entry.group.namespace}:${entry.group.effectiveName}`
    : `mcp-server:${entry.group.effectiveName}`
}

/** The heading naming what is being contested, and by which name. */
export function describeCollisionGroup(entry: MaterializationCollisionGroup): string {
  return entry.kind === 'asset' ? describeNamespace(entry.group.namespace, entry.group.scope) : 'MCP servers'
}

/** One claimant, flattened for rendering. */
export interface CollisionClaimant {
  key: string
  facet: string
  /** What the claimant is, in the user's words. */
  label: string
  authoredName: string
  /** The exact `facets.json` path a choice is written to. */
  location: string
}

/**
 * Every claimant of a group, in one shape.
 *
 * Shared so the Ink block and the stderr report cannot disagree about which
 * claimants exist or where a user edits them — the two surfaces render the
 * same failure, and only one of them is visible in CI.
 */
export function collisionClaimants(entry: MaterializationCollisionGroup): CollisionClaimant[] {
  if (entry.kind === 'asset') {
    return entry.group.members.map((member) => ({
      key: `${member.facet}:${member.type}:${member.authoredName}`,
      facet: member.facet,
      label: `${member.type} ${member.authoredName}`,
      authoredName: member.authoredName,
      location: manifestLocation(member.facet, member.type, member.authoredName),
    }))
  }
  return entry.group.members.map((member) => ({
    key: `${member.facet}:mcp-server:${member.authoredName}`,
    facet: member.facet,
    label: `server ${member.authoredName}`,
    authoredName: member.authoredName,
    location: serverManifestLocation(member.facet, member.authoredName),
  }))
}

/** The full stderr report for an unresolved collision. */
export function formatCollisionReport(
  groups: readonly MaterializationCollisionGroup[],
  staleOverrides: readonly StaleMaterializationOverride[],
): string {
  const lines: string[] = []

  lines.push(
    `Two or more facets want the same name, so installation stopped before writing anything.`,
    `Every claimant below needs one choice: keep its name, give it a different one, or leave it out.`,
    ``,
  )

  for (const entry of groups) {
    if (entry.kind === 'asset') {
      const group = entry.group
      lines.push(`  ${describeNamespace(group.namespace, group.scope)} — "${group.effectiveName}" is claimed by:`)
      for (const member of group.members) {
        const via = member.disposition.kind === 'aliased' ? ` (already aliased from "${member.authoredName}")` : ''
        lines.push(`    • ${member.facet}: ${member.type} "${member.authoredName}" → "${member.effectiveName}"${via}`)
        lines.push(`        edit ${manifestLocation(member.facet, member.type, member.authoredName)}`)
        lines.push(`          alias:  ${aliasSnippet(member.authoredName)}`)
        lines.push(`          omit:   ${omitSnippet(member.authoredName)}`)
      }
      lines.push(``)
      continue
    }
    const group = entry.group
    lines.push(`  MCP servers — "${group.effectiveName}" is claimed by:`)
    for (const member of group.members) {
      const via = member.disposition.kind === 'aliased' ? ` (already aliased from "${member.authoredName}")` : ''
      lines.push(`    • ${member.facet}: server "${member.authoredName}" → "${member.effectiveName}"${via}`)
      lines.push(`        ${describeDeclaration(member.declaration)}`)
      lines.push(`        edit ${serverManifestLocation(member.facet, member.authoredName)}`)
      lines.push(`          alias:  ${aliasSnippet(member.authoredName)}`)
      lines.push(`          omit:   ${omitSnippet(member.authoredName)}`)
    }
    lines.push(``)
  }

  lines.push(
    `  Replace ${JSON.stringify(PLACEHOLDER_ALIAS)} with whatever name you want; it only has to`,
    `  differ from the other claimants. A facet entry carrying a choice looks like:`,
    ``,
    `    "${exampleFacet(groups)}": {`,
    `      "source": "<the source string already in facets.json>",`,
    `      "materialization": { ${exampleOverrideBody(groups)} }`,
    `    }`,
    ``,
  )

  if (staleOverrides.length > 0) {
    lines.push(`  Also note — these recorded choices name contributions the resolved versions no longer contain:`)
    for (const stale of staleOverrides) {
      lines.push(`    • ${stale.facet}: ${describeContribution(stale.contribution)} "${stale.authoredName}"`)
    }
    lines.push(``)
  }

  lines.push(`  facets.json, facets.lock, the install receipt, and your materialized assets were NOT changed.`)

  return lines.join('\n')
}

/**
 * A one-line summary of a declaration, enough to tell two colliding servers
 * apart without reproducing the declaration itself.
 *
 * Deliberately not the full command, arguments, environment, or URL. This
 * report goes to stderr, which is a log file in exactly the situations that
 * produce it, and the complete declaration belongs only on the interactive
 * approval screen. The fingerprint prefix is the tiebreaker when two
 * summaries coincide: it is derived from the whole declaration but reveals
 * none of it.
 */
function describeDeclaration(declaration: McpServerDeclaration): string {
  switch (declaration.type) {
    case 'stdio':
      return `stdio, command "${declaration.command}"`
    case 'http':
      return `http, ${new URL(declaration.url).origin}`
  }
}

function aliasSnippet(authoredName: string): string {
  return `${JSON.stringify(authoredName)}: { "kind": "aliased", "as": ${JSON.stringify(PLACEHOLDER_ALIAS)} }`
}

function omitSnippet(authoredName: string): string {
  return `${JSON.stringify(authoredName)}: { "kind": "omitted" }`
}

/**
 * A facet name for the shape example.
 *
 * Uses the first claimant of the first group only so the example is
 * concrete. It is not a suggestion about which facet should yield —
 * every claimant already got the identical pair of snippets above.
 */
function exampleFacet(groups: readonly MaterializationCollisionGroup[]): string {
  return groups[0]?.group.members[0]?.facet ?? 'your-facet'
}

function exampleOverrideBody(groups: readonly MaterializationCollisionGroup[]): string {
  const first = groups[0]
  if (first === undefined) return `"skills": { ${aliasSnippet('asset-name')} }`
  if (first.kind === 'mcp-server') {
    const member = first.group.members[0]
    if (member === undefined) return `"${SERVER_OVERRIDE_GROUP}": { ${aliasSnippet('server-name')} }`
    return `"${SERVER_OVERRIDE_GROUP}": { ${aliasSnippet(member.authoredName)} }`
  }
  const member = first.group.members[0]
  if (member === undefined) return `"skills": { ${aliasSnippet('asset-name')} }`
  return `"${overrideGroupKey(member.type)}": { ${aliasSnippet(member.authoredName)} }`
}

/**
 * Write the long-form stderr detail for a materialization failure, if it
 * has one. Returns whether anything was written.
 *
 * Called before the canonical three-line block so the `fix:` line stays
 * the last thing on the stream, where people look for it.
 */
export function writeMaterializationDetail(failure: RunInstallFailure): boolean {
  switch (failure.code) {
    case 'MATERIALIZATION_COLLISION':
      process.stderr.write(`${formatCollisionReport(failure.groups, failure.staleOverrides)}\n`)
      return true
    case 'MATERIALIZATION_RESOLUTION_INVALID':
      process.stderr.write(
        `${formatCollisionReport(failure.groups, [])}\n${failure.problems
          .map((problem) => `  • ${problem.facet}: alias "${problem.alias}" ${problem.reason}`)
          .join('\n')}\n`,
      )
      return true
    case 'MATERIALIZATION_ALIAS_INVALID':
      process.stderr.write(
        `A materialization alias in facets.json is not a legal asset name. Nothing was changed.\n${failure.problems
          .map((problem) => `  • ${problem.facet}: "${problem.alias}" ${problem.reason}`)
          .join('\n')}\n`,
      )
      return true
    default:
      return false
  }
}
