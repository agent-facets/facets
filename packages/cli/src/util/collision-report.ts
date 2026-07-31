import type { AssetType, Scope } from '@agent-facets/common'
import type { RunInstallFailure } from '@agent-facets/engine'
import type { CollisionGroup, MaterializationNamespace, StaleOverride } from '@agent-facets/protocol'
import { overrideGroupKey } from '@agent-facets/protocol'

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

/** The full stderr report for an unresolved collision. */
export function formatCollisionReport(
  groups: readonly CollisionGroup[],
  staleOverrides: readonly StaleOverride[],
): string {
  const lines: string[] = []

  lines.push(
    `Two or more facets want the same name, so installation stopped before writing anything.`,
    `Every asset below needs one choice: keep its name, give it a different one, or leave it out.`,
    ``,
  )

  for (const group of groups) {
    lines.push(`  ${describeNamespace(group.namespace, group.scope)} — "${group.effectiveName}" is claimed by:`)
    for (const member of group.members) {
      const via = member.disposition.kind === 'aliased' ? ` (already aliased from "${member.authoredName}")` : ''
      lines.push(`    • ${member.facet}: ${member.type} "${member.authoredName}" → "${member.effectiveName}"${via}`)
      lines.push(`        edit ${manifestLocation(member.facet, member.type, member.authoredName)}`)
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
    lines.push(`  Also note — these recorded choices name assets the resolved versions no longer contain:`)
    for (const stale of staleOverrides) {
      lines.push(`    • ${stale.facet}: ${stale.type} "${stale.authoredName}"`)
    }
    lines.push(``)
  }

  lines.push(`  facets.json, facets.lock, the install receipt, and your materialized assets were NOT changed.`)

  return lines.join('\n')
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
function exampleFacet(groups: readonly CollisionGroup[]): string {
  return groups[0]?.members[0]?.facet ?? 'your-facet'
}

function exampleOverrideBody(groups: readonly CollisionGroup[]): string {
  const member = groups[0]?.members[0]
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
