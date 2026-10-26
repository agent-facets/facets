export interface TapFormulaState {
  version: string
  content: string
}

export interface TapUpdatePullRequest {
  number: number
  version: string
  branch: string
  content: string
}

export interface PlanHomebrewTapUpdateInput {
  formula: TapFormulaState
  defaultFormula: TapFormulaState | null
  openUpdates: TapUpdatePullRequest[]
}

export type PlanHomebrewTapUpdateResult =
  | { ok: true; kind: 'already-applied' }
  | { ok: true; kind: 'reuse'; pullRequest: number; supersede: number[] }
  | { ok: true; kind: 'create'; branch: string; supersede: number[] }
  | { ok: false; code: 'invalid-version'; version: string }
  | { ok: false; code: 'downgrade'; currentVersion: string }
  | { ok: false; code: 'remote-drift'; pullRequest: number }

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match?.[1] || !match[2] || !match[3]) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(left: string, right: string): number | undefined {
  const l = parseVersion(left)
  const r = parseVersion(right)
  if (!l || !r) return undefined
  return l[0] - r[0] || l[1] - r[1] || l[2] - r[2]
}

function branchFor(version: string): string {
  return `homebrew/facet-${version}`
}

/**
 * Plan one monotonic Homebrew formula update without writing to the tap.
 * The apply lane must execute only this returned plan and re-read state before
 * every write, so an old release job cannot downgrade Formula/facet.rb.
 */
export function planHomebrewTapUpdate(input: PlanHomebrewTapUpdateInput): PlanHomebrewTapUpdateResult {
  if (!parseVersion(input.formula.version))
    return { ok: false, code: 'invalid-version', version: input.formula.version }
  if (input.defaultFormula) {
    const comparison = compareVersions(input.formula.version, input.defaultFormula.version)
    if (comparison === undefined) return { ok: false, code: 'invalid-version', version: input.defaultFormula.version }
    if (comparison < 0) return { ok: false, code: 'downgrade', currentVersion: input.defaultFormula.version }
    if (comparison === 0) {
      return input.formula.content === input.defaultFormula.content
        ? { ok: true, kind: 'already-applied' }
        : { ok: false, code: 'remote-drift', pullRequest: 0 }
    }
  }

  const matching = input.openUpdates.find((update) => update.version === input.formula.version)
  if (matching && matching.content !== input.formula.content) {
    return { ok: false, code: 'remote-drift', pullRequest: matching.number }
  }
  const supersede = input.openUpdates
    .filter((update) => compareVersions(update.version, input.formula.version) === -1)
    .map((update) => update.number)

  return matching
    ? { ok: true, kind: 'reuse', pullRequest: matching.number, supersede }
    : { ok: true, kind: 'create', branch: branchFor(input.formula.version), supersede }
}
