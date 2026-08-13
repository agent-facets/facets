import type { AssetType, Scope } from '@agent-facets/common'
import type {
  MaterializationAliasProblem,
  MaterializationCollisionGroup,
  RunInstallFailure,
  StaleMaterializationOverride,
} from '@agent-facets/engine'
import type {
  MaterializationNamespace,
  McpServerFingerprint,
  ReadonlyMcpServerDeclaration,
} from '@agent-facets/protocol'
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
  /** What the claimant is, in the user's words — including its scope, for an asset. */
  label: string
  authoredName: string
  /** The name it is claiming. Always present: a collision is a claim on one. */
  effectiveName: string
  /**
   * Extra lines about this claimant, rendered under it. Empty for an asset,
   * one declaration summary for a server.
   *
   * A list rather than an optional string: "no extra detail" and "a detail
   * that happens to be empty" are the same thing to a renderer, and a
   * `string | undefined` invites a caller to print `undefined`.
   */
  detail: readonly string[]
  /** The exact `facets.json` path a choice is written to. */
  location: string
  /**
   * The authored name this claimant was aliased FROM, or `false` when it was
   * not aliased.
   *
   * Carried here rather than looked up again by a renderer. Authored names are
   * not unique across a group — two facets may both author `review` — so a
   * second lookup by name alone can attach this annotation to the wrong
   * claimant, or drop it from the one that actually has it. This projection
   * already knows which member it came from, so it answers the question once.
   */
  aliasedFrom: false | string
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
      key: `${member.facet}:${member.scope}:${member.type}:${member.authoredName}`,
      facet: member.facet,
      label: `${member.scope} ${member.type} ${member.authoredName}`,
      authoredName: member.authoredName,
      effectiveName: member.effectiveName,
      detail: [],
      location: manifestLocation(member.facet, member.type, member.authoredName),
      aliasedFrom: aliasedFrom(member),
    }))
  }
  return entry.group.members.map((member) => ({
    key: `${member.facet}:mcp-server:${member.authoredName}`,
    facet: member.facet,
    label: `server ${member.authoredName}`,
    authoredName: member.authoredName,
    effectiveName: member.effectiveName,
    detail: [describeClaimantDeclaration(member.declaration, member.fingerprint)],
    location: serverManifestLocation(member.facet, member.authoredName),
    aliasedFrom: aliasedFrom(member),
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
    lines.push(`  ${describeCollisionGroup(entry)} — "${entry.group.effectiveName}" is claimed by:`)
    for (const claimant of collisionClaimants(entry)) {
      lines.push(`    • ${claimant.facet}: ${claimant.label} → "${claimant.effectiveName}"${describeAlias(claimant)}`)
      for (const detail of claimant.detail) lines.push(`        ${detail}`)
      lines.push(`        edit ${claimant.location}`)
      lines.push(`          alias:  ${aliasSnippet(claimant.authoredName)}`)
      lines.push(`          omit:   ${omitSnippet(claimant.authoredName)}`)
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

  lines.push(...UNCHANGED_FOOTER)

  return lines.join('\n')
}

/**
 * The "nothing happened" footer, shared by every pre-mutation report.
 *
 * One copy because it is a claim about the same five things every time. Two
 * copies drift, and the failure mode is a report that quietly stops
 * mentioning one of them after a later report is edited.
 */
export const UNCHANGED_FOOTER: readonly string[] = [
  `  facets.json, facets.lock, the install receipt, your materialized assets, and every tool's`,
  `  MCP configuration were NOT changed.`,
]

/**
 * A one-line summary of a declaration, enough to tell two colliding servers
 * apart without reproducing the declaration itself.
 *
 * Deliberately not the full command line, arguments, environment, or URL
 * path. Both surfaces that call this — this stderr report and the collision
 * workspace — are ordinary command output, and the complete declaration
 * belongs on the approval screen, which is the one place whose purpose is
 * showing a user what they are authorizing.
 *
 * The fingerprint prefix is the tiebreaker. Two colliding declarations can
 * share a command and differ only in arguments or environment, and a user
 * shown two identical lines learns nothing about which row is which. The
 * prefix is derived from the whole declaration and reveals none of it.
 */
export function describeClaimantDeclaration(
  declaration: ReadonlyMcpServerDeclaration,
  fingerprint: McpServerFingerprint,
): string {
  const summary =
    declaration.type === 'stdio' ? `stdio, command "${declaration.command}"` : `http, ${originOf(declaration.url)}`
  return `${summary} · ${shortFingerprint(fingerprint)}`
}

/**
 * The origin of an absolute HTTP(S) URL.
 *
 * Parsed with the same WHATWG rules the schema validated it under, because a
 * regex over the raw text does not implement those rules and the difference
 * leaks. `https://example.com\secret-token` is a valid URL whose path is
 * `/secret-token`, but a character class of "not `/?#`" runs straight through
 * the backslash; leading whitespace misses an anchored pattern entirely. Both
 * used to fall back to returning the whole string — on a surface whose entire
 * promise is that it does not print the path.
 *
 * A formatter must not throw, so a value that somehow reaches this unvalidated
 * becomes a fixed sentinel rather than an echo of itself.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return '<unparseable url>'
  }
}

/** The first few hex digits of a fingerprint, enough to tell two rows apart. */
function shortFingerprint(fingerprint: McpServerFingerprint): string {
  return fingerprint.slice('sha256:'.length, 'sha256:'.length + 8)
}

/** The authored name a member was aliased from, taken from that exact member. */
function aliasedFrom(member: { disposition: { kind: string }; authoredName: string }): false | string {
  return member.disposition.kind === 'aliased' ? member.authoredName : false
}

/** How this claimant already reached the contested name, if by an alias. */
export function describeAlias(claimant: CollisionClaimant): string {
  return claimant.aliasedFrom === false ? '' : ` (already aliased from "${claimant.aliasedFrom}")`
}

function aliasSnippet(authoredName: string): string {
  return `${JSON.stringify(authoredName)}: { "kind": "aliased", "as": ${JSON.stringify(PLACEHOLDER_ALIAS)} }`
}

/** The exact JSON member that removes one contribution from the active set. */
export function omitSnippet(authoredName: string): string {
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

/** Where in `facets.json` the alias that failed validation is written. */
export function aliasProblemLocation(problem: MaterializationAliasProblem): string {
  return problem.kind === 'asset'
    ? manifestLocation(problem.facet, problem.assetType, problem.authoredName)
    : serverManifestLocation(problem.facet, problem.authoredName)
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
          .map((problem) => `  • alias "${problem.alias}" ${problem.reason}\n      at ${aliasProblemLocation(problem)}`)
          .join('\n')}\n`,
      )
      return true
    case 'MATERIALIZATION_ALIAS_INVALID':
      process.stderr.write(
        `A materialization alias in facets.json is not a legal name. Nothing was changed.\n${failure.problems
          .map((problem) => `  • "${problem.alias}" ${problem.reason}\n      at ${aliasProblemLocation(problem)}`)
          .join('\n')}\n`,
      )
      return true
    default:
      return false
  }
}
